# 用官方 tokenizers 库给同一批文本分词，输出 id，供 check-tokenizer.ts 和我们自己的实现逐个比对。
# 只在验证时用，项目运行不依赖 Python。
# 用法：python -I scripts/corpus/check-tokenizer.py <tokenizer.json> <texts.json> <out.json>
import json
import sys

from tokenizers import Tokenizer

tok = Tokenizer.from_file(sys.argv[1])
texts = json.load(open(sys.argv[2], encoding="utf-8"))
out = [tok.encode(t).ids for t in texts]
json.dump(out, open(sys.argv[3], "w", encoding="utf-8"))
print(f"encoded {len(out)} texts")
