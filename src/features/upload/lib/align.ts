// 把模型识别的文字和浏览器本地 OCR 的行框对齐。
// 10-30 实验：模型的文字准（示例合同截图字错率 0%），但给出的框偏差太大，没法用；
// 本地 Tesseract 的框准（IoU 中位数 0.90），文字错字多。所以文字用模型的，框用本地的，按行对齐。
//
// 对齐是带"合并"的序列比对：允许一行对一行、模型一行对本地两行（本地把一行切成了两段）、
// 模型两行对本地一行（本地把两行粘在一起），以及两边各自有多出来的行。

export type Box = [number, number, number, number]; // 像素坐标 [x0, y0, x1, y1]
export type LocalLine = { text: string; box: Box };
export type AlignedLine = { text: string; box: Box | null; score: number };

const clean = (s: string) => s.replace(/[\s，,。.：:；;、（）()“”"'《》<>【】\[\]-]/g, "");

/** 字符二元组的 Dice 系数，0~1。短于两个字时退化成单字比较 */
export function similarity(a: string, b: string): number {
  const x = clean(a);
  const y = clean(b);
  if (!x || !y) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    const n = s.length < 2 ? 1 : 2;
    for (let i = 0; i + n <= s.length; i++) {
      const g = s.slice(i, i + n);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(x);
  const gb = grams(y);
  let inter = 0;
  let total = 0;
  for (const [g, c] of ga) {
    inter += Math.min(c, gb.get(g) ?? 0);
    total += c;
  }
  for (const c of gb.values()) total += c;
  return (2 * inter) / total;
}

/** a 的二元组有多少比例出现在 b 里：判断"a 是 b 的一部分" */
export function containment(a: string, b: string): number {
  const x = clean(a);
  const y = clean(b);
  if (!x || !y) return 0;
  const n = x.length < 2 ? 1 : 2;
  const pool = new Map<string, number>();
  for (let i = 0; i + n <= y.length; i++)
    pool.set(y.slice(i, i + n), (pool.get(y.slice(i, i + n)) ?? 0) + 1);
  let hit = 0;
  let total = 0;
  for (let i = 0; i + n <= x.length; i++) {
    total++;
    const g = x.slice(i, i + n);
    const c = pool.get(g) ?? 0;
    if (c > 0) {
      hit++;
      pool.set(g, c - 1);
    }
  }
  return total ? hit / total : 0;
}

// 合并、拆分时每一段都要有这么大比例出现在另一边，免得把漏掉的行或噪声行并进来
const MIN_PART = 0.5;

const union = (a: Box, b: Box): Box => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
];

// 低于这个相似度不算对上；本地 OCR 错字多，阈值放得低一些
const MIN_SIM = 0.3;

type Step = "match" | "split" | "merge" | "skipModel" | "skipLocal";

export function alignLines(model: string[], local: LocalLine[]): AlignedLine[] {
  const n = model.length;
  const m = local.length;
  // dp[i][j]：前 i 行模型文字和前 j 行本地结果的最大得分
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(-Infinity));
  const from: Step[][] = Array.from({ length: n + 1 }, () => new Array<Step>(m + 1));
  dp[0][0] = 0;
  const consider = (i: number, j: number, v: number, s: Step) => {
    if (v > dp[i][j]) {
      dp[i][j] = v;
      from[i][j] = s;
    }
  };
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const cur = dp[i][j];
      if (cur === -Infinity) continue;
      if (i < n) consider(i + 1, j, cur, "skipModel");
      if (j < m) consider(i, j + 1, cur, "skipLocal");
      if (i < n && j < m) {
        const s = similarity(model[i], local[j].text);
        if (s >= MIN_SIM) consider(i + 1, j + 1, cur + s, "match");
      }
      if (i < n && j + 1 < m) {
        const s = similarity(model[i], local[j].text + local[j + 1].text);
        const parts =
          containment(local[j].text, model[i]) >= MIN_PART &&
          containment(local[j + 1].text, model[i]) >= MIN_PART;
        if (s >= MIN_SIM && parts) consider(i + 1, j + 2, cur + s * 2 - 0.2, "split");
      }
      if (i + 1 < n && j < m) {
        const s = similarity(model[i] + model[i + 1], local[j].text);
        const parts =
          containment(model[i], local[j].text) >= MIN_PART &&
          containment(model[i + 1], local[j].text) >= MIN_PART;
        if (s >= MIN_SIM && parts) consider(i + 2, j + 1, cur + s * 2 - 0.2, "merge");
      }
    }
  }

  const out: AlignedLine[] = new Array(n);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const s = from[i][j];
    if (s === "skipModel") {
      out[i - 1] = { text: model[i - 1], box: null, score: 0 };
      i--;
    } else if (s === "skipLocal") {
      j--;
    } else if (s === "match") {
      out[i - 1] = {
        text: model[i - 1],
        box: local[j - 1].box,
        score: similarity(model[i - 1], local[j - 1].text),
      };
      i--;
      j--;
    } else if (s === "split") {
      const box = union(local[j - 2].box, local[j - 1].box);
      out[i - 1] = {
        text: model[i - 1],
        box,
        score: similarity(model[i - 1], local[j - 2].text + local[j - 1].text),
      };
      i--;
      j -= 2;
    } else {
      // merge：两行模型文字落在同一个本地框里，按字数比例上下切开
      const b = local[j - 1].box;
      const a1 = clean(model[i - 2]).length;
      const a2 = clean(model[i - 1]).length;
      const mid = b[1] + ((b[3] - b[1]) * a1) / Math.max(1, a1 + a2);
      const score = similarity(model[i - 2] + model[i - 1], local[j - 1].text);
      out[i - 2] = { text: model[i - 2], box: [b[0], b[1], b[2], mid], score };
      out[i - 1] = { text: model[i - 1], box: [b[0], mid, b[2], b[3]], score };
      i -= 2;
      j--;
    }
  }
  return out;
}

export type MergedLine = {
  text: string;
  box: Box | null;
  // model：模型识别的文字；local：模型漏了这一行，先用本地识别的文字，界面提示核对；
  // user：用户在识别结果里改过或新加的行（edit-lines.ts）
  source: "model" | "local" | "user";
};

/**
 * 合并一页的识别结果，按页面上的位置排序。
 * 同时给出"模型从哪一行开始没识别"：模型有时会中途停下（10-30 实验里劳动合同截图两次都停在第五、六条），
 * 末尾连续两行以上本地有、模型没有，就返回那一行的上沿，调用方把这以下的部分裁出来再识别一次。
 */
export function mergeRecognition(
  model: string[],
  local: LocalLine[],
): { lines: MergedLine[]; resumeFromY: number | null } {
  const aligned = alignLines(model, local);
  const used = new Set<number>();
  for (const a of aligned) {
    if (!a.box) continue;
    local.forEach((l, k) => {
      const b = l.box;
      // 对上的框覆盖了本地这一行的中心，就算用过
      const cy = (b[1] + b[3]) / 2;
      if (a.box && cy >= a.box[1] && cy <= a.box[3] && b[0] < a.box[2] && b[2] > a.box[0])
        used.add(k);
    });
  }
  const meaningful = (l: LocalLine) => l.text.replace(/\s/g, "").length >= 4;
  // 末尾连续没对上的本地行
  let tail = local.length;
  while (tail > 0 && !used.has(tail - 1)) tail--;
  const trailing = local.slice(tail).filter(meaningful);
  const resumeFromY = trailing.length >= 2 ? local[tail].box[1] : null;

  const lines: MergedLine[] = aligned.map((a) => ({
    text: a.text,
    box: a.box,
    source: "model" as const,
  }));
  local.forEach((l, k) => {
    if (used.has(k) || !meaningful(l)) return;
    if (resumeFromY !== null && k >= tail) return; // 这部分会重新识别
    lines.push({ text: l.text, box: l.box, source: "local" });
  });
  // 有框的按纵坐标排；没框的（模型有、本地没找到）保持在前一行后面
  const ordered: MergedLine[] = [];
  const withBox = lines.filter((l) => l.box).sort((a, b) => a.box![1] - b.box![1]);
  let wi = 0;
  for (const l of aligned.map((a, i) => ({ a, i }))) {
    if (l.a.box) continue;
    // 没框的模型行插在它前一条有框模型行的后面
    const prev = aligned
      .slice(0, l.i)
      .reverse()
      .find((x) => x.box);
    while (wi < withBox.length && (!prev || withBox[wi].box![1] <= prev.box![1]))
      ordered.push(withBox[wi++]);
    ordered.push({ text: l.a.text, box: null, source: "model" });
  }
  while (wi < withBox.length) ordered.push(withBox[wi++]);
  return { lines: ordered, resumeFromY };
}
