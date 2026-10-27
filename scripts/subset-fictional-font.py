from fontTools.ttLib import TTFont
from fontTools import subset
import json,pathlib
root=pathlib.Path(__file__).resolve().parent.parent/'tests/fixtures/pdf-assets';root.mkdir(exist_ok=True)
# Entirely fictional text; no material copied from the user's document.
chars='虚构学习资料第部分单元编号规则名称答案问题标准说明后续内容管理甲乙丙丁一二三四五六七八九十中文跨页长段落提示口诀解释单独核对图片识别扫描测试终止完成需确认示例空白仅有正文扫描件第页ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789：:．.、（）()？！? !，,。-'
f=TTFont('/usr/share/fonts/truetype/arphic/uming.ttc',fontNumber=0,recalcTimestamp=False)
opt=subset.Options();opt.recalc_timestamp=False
sub=subset.Subsetter(options=opt);sub.populate(text=chars);sub.subset(f)
f.save(root/'fictional-cjk.ttf')
units=f['head'].unitsPerEm;cmap=f.getBestCmap()
entries={str(c):{'gid':f.getGlyphID(n),'width':round(f['hmtx'][n][0]*1000/units)} for c,n in cmap.items()}
(root/'font-map.json').write_text(json.dumps(entries,sort_keys=True))
print({'fixtureFontBytes':(root/'fictional-cjk.ttf').stat().st_size,'glyphs':len(entries)})
