#!/usr/bin/env python3
"""Build officials_ages.json: ages from the seminar roster matched onto officials_live.json.

Source: ตัวอย่างรายชื่อสัมมนา ซ้อมสุ่มสี.xlsx  (col A=ลำดับ, B=ชื่อ, C=สกุล, D=ตำแหน่ง, E=อายุ)
Target: officials_live.json (509 records, has per_name / per_surname / seq)

Matching: exact on (ชื่อ+สกุล) after stripping the title prefix, then difflib >= 0.86.
Output is keyed twice so the page can fall back: by_seq (stable) and by_name (normalised).
"""
import difflib
import json
import re
import unicodedata
from datetime import datetime, timezone

import openpyxl

XLSX = 'ตัวอย่างรายชื่อสัมมนา ซ้อมสุ่มสี.xlsx'
OUT = 'officials_ages.json'
PRE = re.compile(r'^(นางสาว|นาง|นาย|ด\.ช\.|ด\.ญ\.|ว่าที่ร้อยตรี|ร้อยเอก|พันเอก)\s*')
HEADER = {'ชื่อ - สกุล', 'ชื่อ-สกุล', 'ชื่อ -สกุล'}


def norm(s):
    return re.sub(r'\s+', '', unicodedata.normalize('NFC', str(s or '')))


def read_xlsx(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.worksheets[0]
    rows = []
    for r in ws.iter_rows(min_row=4, values_only=True):
        a, b, c, d, e = (list(r) + [None] * 5)[:5]
        if not isinstance(b, str) or not b.strip():
            continue
        if b.strip() in HEADER:
            continue
        given = PRE.sub('', b.strip())
        age = None
        if isinstance(e, (int, float)):
            age = int(e)
        elif isinstance(e, str):
            m = re.search(r'\d{1,3}', e)
            age = int(m.group()) if m else None
        rows.append({
            'key': norm(given) + norm(c),
            'display': (b.strip() + ' ' + str(c or '').strip()).strip(),
            'age': age,
        })
    return rows


def main():
    officials = json.load(open('officials_live.json', encoding='utf-8'))
    if not isinstance(officials, list):
        officials = officials.get('officials') or officials.get('data') or []

    index = {}
    for o in officials:
        index.setdefault(norm(o.get('per_name')) + norm(o.get('per_surname')), []).append(o)
    keys = list(index)

    by_seq, by_name, matched, fuzzy, unmatched = {}, {}, 0, 0, []
    for row in read_xlsx(XLSX):
        if row['age'] is None:
            continue
        hit = index.get(row['key'])
        if hit and len(hit) == 1:
            how = 'exact'
        else:
            near = difflib.get_close_matches(row['key'], keys, n=1, cutoff=0.86)
            hit = index[near[0]] if near and len(index[near[0]]) == 1 else None
            how = 'fuzzy'
        if not hit:
            unmatched.append(row['display'])
            continue
        person = hit[0]
        by_name[row['key']] = row['age']
        if person.get('seq') is not None:
            by_seq[str(person['seq'])] = row['age']
        matched += 1
        if how == 'fuzzy':
            fuzzy += 1

    payload = {
        'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'source': XLSX,
        'counts': {
            'officials': len(officials),
            'with_age': len(by_seq),
            'matched_exact': matched - fuzzy,
            'matched_fuzzy': fuzzy,
            'unmatched_rows': len(unmatched),
        },
        'by_seq': by_seq,
        'by_name': by_name,
        'unmatched': sorted(unmatched),
    }
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
    print(json.dumps(payload['counts'], ensure_ascii=False))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
