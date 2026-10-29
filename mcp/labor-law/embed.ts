// 本地向量模型 bge-small-zh-v1.5：分词 + ONNX 推理 + CLS 池化 + 归一化。
// 用 onnxruntime-web（WebAssembly），不用 onnxruntime-node：后者是原生模块，Windows 上装的到 Linux 跑不了。
// 分词器按模型自带的 tokenizer.json 实现（BertNormalizer + BertPreTokenizer + WordPiece，不转小写），
// 结果和官方 tokenizers 库逐个 id 对过（scripts/corpus/check-tokenizer.py）。

import { readFileSync } from "node:fs";
import * as ort from "onnxruntime-web";

export const MODEL_DIR = "models/bge-small-zh-v1.5";
export const DIM = 512;
const MAX_LEN = 512;
// bge 中文模型建议：短查询找长段落时，查询前加这句说明，段落不加
export const QUERY_INSTRUCTION = "为这个句子生成表示以用于检索相关文章：";

// ── 分词 ────────────────────────────────────────────────

const CJK_RANGES: [number, number][] = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x20000, 0x2a6df],
  [0x2a700, 0x2b73f],
  [0x2b740, 0x2b81f],
  [0x2b820, 0x2ceaf],
  [0xf900, 0xfaff],
  [0x2f800, 0x2fa1f],
];
const isCjk = (cp: number) => CJK_RANGES.some(([a, b]) => cp >= a && cp <= b);
const isControl = (ch: string) =>
  ch !== "\t" && ch !== "\n" && ch !== "\r" && /\p{Cc}|\p{Cf}/u.test(ch);
const isWhitespace = (ch: string) => /\s/u.test(ch);
// 和 BERT 的定义一致：ASCII 标点符号，加上 Unicode 里所有 P 类字符
const isPunct = (ch: string) => {
  const cp = ch.codePointAt(0)!;
  return (
    (cp >= 33 && cp <= 47) ||
    (cp >= 58 && cp <= 64) ||
    (cp >= 91 && cp <= 96) ||
    (cp >= 123 && cp <= 126) ||
    /\p{P}/u.test(ch)
  );
};

export class BertTokenizer {
  private vocab: Map<string, number>;
  readonly cls: number;
  readonly sep: number;
  readonly unk: number;

  constructor(tokenizerJsonPath = `${MODEL_DIR}/tokenizer.json`) {
    const t = JSON.parse(readFileSync(tokenizerJsonPath, "utf8")) as {
      model: { vocab: Record<string, number> };
    };
    this.vocab = new Map(Object.entries(t.model.vocab));
    this.cls = this.vocab.get("[CLS]")!;
    this.sep = this.vocab.get("[SEP]")!;
    this.unk = this.vocab.get("[UNK]")!;
  }

  /** 切词（不含 [CLS] [SEP]） */
  words(text: string): string[] {
    let s = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0 || cp === 0xfffd || isControl(ch)) continue;
      if (isWhitespace(ch)) s += " ";
      else if (isCjk(cp)) s += ` ${ch} `;
      else s += ch;
    }
    const out: string[] = [];
    for (const chunk of s.split(" ")) {
      if (!chunk) continue;
      let buf = "";
      for (const ch of chunk) {
        if (isPunct(ch)) {
          if (buf) out.push(buf);
          out.push(ch);
          buf = "";
        } else buf += ch;
      }
      if (buf) out.push(buf);
    }
    return out;
  }

  /** WordPiece：从左往右每次取词表里最长的一段，后续段加 ## 前缀；有一段找不到就整个词记为 [UNK] */
  private wordPiece(word: string): number[] {
    const chars = [...word];
    if (chars.length > 100) return [this.unk];
    const ids: number[] = [];
    let start = 0;
    while (start < chars.length) {
      let end = chars.length;
      let found: number | undefined;
      while (start < end) {
        const sub = (start > 0 ? "##" : "") + chars.slice(start, end).join("");
        found = this.vocab.get(sub);
        if (found !== undefined) break;
        end--;
      }
      if (found === undefined) return [this.unk];
      ids.push(found);
      start = end;
    }
    return ids;
  }

  /** 编码成模型输入，超长截断到 512（含 [CLS] [SEP]） */
  encode(text: string): number[] {
    const ids = this.words(text).flatMap((w) => this.wordPiece(w));
    return [this.cls, ...ids.slice(0, MAX_LEN - 2), this.sep];
  }
}

// ── 推理 ────────────────────────────────────────────────

// Node 直接运行 .ts 只去掉类型标注，不支持构造函数参数属性这类要编译的语法，这里写成普通字段
export class Embedder {
  private session: ort.InferenceSession;
  readonly tokenizer: BertTokenizer;

  private constructor(session: ort.InferenceSession, tokenizer: BertTokenizer) {
    this.session = session;
    this.tokenizer = tokenizer;
  }

  static async load(dir = MODEL_DIR, threads = 1): Promise<Embedder> {
    // 服务器只有 2 核，同时还要跑网站进程，默认单线程；构建时可以多开
    ort.env.wasm.numThreads = threads;
    const model = new Uint8Array(readFileSync(`${dir}/onnx/model_quantized.onnx`));
    const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
    return new Embedder(session, new BertTokenizer(`${dir}/tokenizer.json`));
  }

  /** 批量编码。同一批按最长的补齐，attention_mask 把补齐部分遮掉；取 [CLS] 位置的向量并归一化 */
  async embed(texts: string[]): Promise<Float32Array[]> {
    const encoded = texts.map((t) => this.tokenizer.encode(t));
    const len = Math.max(...encoded.map((e) => e.length));
    const n = texts.length;
    const ids = new BigInt64Array(n * len);
    const mask = new BigInt64Array(n * len);
    encoded.forEach((e, i) => {
      e.forEach((id, j) => {
        ids[i * len + j] = BigInt(id);
        mask[i * len + j] = 1n;
      });
    });
    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor("int64", ids, [n, len]),
      attention_mask: new ort.Tensor("int64", mask, [n, len]),
    };
    if (this.session.inputNames.includes("token_type_ids")) {
      feeds.token_type_ids = new ort.Tensor("int64", new BigInt64Array(n * len), [n, len]);
    }
    const out = await this.session.run(feeds);
    const hidden = out[this.session.outputNames[0]].data as Float32Array;
    const vecs: Float32Array[] = [];
    for (let i = 0; i < n; i++) {
      const v = hidden.slice(i * len * DIM, i * len * DIM + DIM);
      let norm = 0;
      for (const x of v) norm += x * x;
      norm = Math.sqrt(norm);
      for (let k = 0; k < DIM; k++) v[k] /= norm;
      vecs.push(v);
    }
    return vecs;
  }

  async embedQuery(q: string): Promise<Float32Array> {
    return (await this.embed([QUERY_INSTRUCTION + q]))[0];
  }
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
