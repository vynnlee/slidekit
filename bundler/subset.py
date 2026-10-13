# 글꼴 부분집합 일괄 처리: python subset.py <chars.txt> <jobs.json>   jobs: [{"in": 경로, "out": 경로}]
# 입력은 ttf, otf, woff, woff2 모두 가능하고 출력은 항상 woff2다. 가변 글꼴 축은 그대로 둔다.
import json, sys
from fontTools import subset

chars = open(sys.argv[1], encoding="utf-8").read()
for job in json.load(open(sys.argv[2])):
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.flavor = "woff2"
    opts.notdef_outline = True
    opts.hinting = False
    font = subset.load_font(job["in"], opts)
    s = subset.Subsetter(opts)
    s.populate(text=chars)
    s.subset(font)
    subset.save_font(font, job["out"], opts)
