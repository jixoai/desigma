#!/usr/bin/env python3
"""Rebuild the browser's OFL fallback. Requires fonttools==4.68.0 (build-time only)."""
import argparse,hashlib,json,tempfile,urllib.request
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'crates/desigma-fonts/assets/cjk'
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path);args=parser.parse_args()
    source=json.loads((DEST/'source.json').read_text())
    with tempfile.TemporaryDirectory() as tmp:
        path=args.source or Path(tmp)/'source.ttf'
        if args.source is None:urllib.request.urlretrieve(source['source'],path)
        if hashlib.sha256(path.read_bytes()).hexdigest()!=source['sha256']:raise SystemExit('Source font hash mismatch')
        font=TTFont(path,recalcTimestamp=False);font['head'].modified=source['derivative_modified_timestamp'];instantiateVariableFont(font,{'wght':400},inplace=True)
        chars={c for lo,hi in json.loads((DEST/'unicode-ranges.json').read_text()) for c in range(lo,hi+1)}
        options=subset.Options();options.name_IDs=['*'];options.name_languages=['*'];options.layout_features=['*']
        sub=subset.Subsetter(options=options);sub.populate(unicodes=chars);sub.subset(font)
        for record in font['name'].names:
            if record.nameID in [1,16]:value='FDE2E UI CJK'
            elif record.nameID in [4,6]:value='FDE2E-UI-CJK-Regular'
            elif record.nameID in [2,17]:value='Regular'
            else:continue
            record.string=value.encode(record.getEncoding())
        output=DEST/'FDE2E-UI-CJK-Regular.ttf';font.save(output)
        print(json.dumps({'bytes':output.stat().st_size,'glyphs':len(font.getBestCmap()),'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}))
if __name__=='__main__':main()
