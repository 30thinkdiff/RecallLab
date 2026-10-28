# Optional developer tool: pip install PyMuPDF Pillow. Uses fictional fixtures only.
import pathlib, zlib, json
import pymupdf
from PIL import Image, ImageFilter
root=pathlib.Path(__file__).resolve().parent.parent/'tests/fixtures'
doc=pymupdf.open(root/'import/chinese-cross-page.pdf')
meta=[]
for i,page in enumerate(doc):
 pix=page.get_pixmap(matrix=pymupdf.Matrix(2,2),colorspace=pymupdf.csGRAY)
 path=root/f'pdf-assets/scan-{i+1}.deflate'
 path.write_bytes(zlib.compress(pix.samples,9));meta.append({'width':pix.width,'height':pix.height,'asset':path.name})
(root/'pdf-assets/scans.json').write_text(json.dumps(meta,indent=2)+'\n')
pix=doc[0].get_pixmap(matrix=pymupdf.Matrix(1,1),colorspace=pymupdf.csGRAY)
im=Image.frombytes('L',(pix.width,pix.height),pix.samples).filter(ImageFilter.GaussianBlur(2.5))
(root/'pdf-assets/blurred.deflate').write_bytes(zlib.compress(im.tobytes(),9))
(root/'pdf-assets/blurred.json').write_text(json.dumps({'width':pix.width,'height':pix.height,'asset':'blurred.deflate'})+'\n')
english=pymupdf.open(root/'import/text-two-pages.pdf')
pix=english[0].get_pixmap(matrix=pymupdf.Matrix(2,2),colorspace=pymupdf.csGRAY)
(root/'pdf-assets/english.deflate').write_bytes(zlib.compress(pix.samples,9))
(root/'pdf-assets/english.json').write_text(json.dumps({'width':pix.width,'height':pix.height,'asset':'english.deflate'})+'\n')
# Encryption has random salts by design. Commit the public fixture, do not expect byte reproduction.
doc.save(root/'import/encrypted.pdf',encryption=pymupdf.PDF_ENCRYPT_AES_256,owner_pw='fictional-owner',user_pw='fictional-test')
print('Generated only public fictional scans, a blurred page, and an encrypted fixture.')
