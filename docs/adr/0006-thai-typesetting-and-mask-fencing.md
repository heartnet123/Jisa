---
id: ADR-0006
title: ระบบจัดวางและเรนเดอร์ตัวอักษรภาษาไทย (Typesetting Engine) พร้อม Mask Fencing
status: Accepted
date: 2026-07-24
deciders:
  - Typesetting & UI Team
tags:
  - backend
  - typesetting
  - pillow
  - thai-nlp
  - mask-fencing
---

# ADR-0006: ระบบจัดวางและเรนเดอร์ตัวอักษรภาษาไทย (Typesetting Engine) พร้อม Mask Fencing

## Status

**Accepted** — ระบบเรนเดอร์ตัวอักษรใช้งานจริงในโมดูล `backend/synthesis/typesetting.py`

## Decision summary

เลือกใช้ **Rule-based Pillow Rendering Engine** ร่วมกับระบบ **Thai Word Wrapping (PyThaiNLP / Regex Fallback)**, **Iterative Font Auto-fitting**, และเทคโนโลยี **Mask Fencing (Bubble Clipping Mask)** เพื่อตัดพิกเซลตัวหนังสือส่วนเกินไม่ให้ล้นออกนอกขอบกรอบคำพูดการ์ตูน พร้อมรองรับฟอนต์ภาษาไทยมาตรฐาน (`Itim`, `NotoSansThai`)

## Context

การพิมพ์ข้อความแปลภาษาไทยลงในกรอบคำพูดมังงะมีข้อจำกัดเฉพาะตัวที่ซับซ้อน:
1. **ภาษาไทยไม่มีการเว้นวรรคระหว่างคำ**: การตัดคำ (Word Wrapping) ด้วย Space แบบภาษาอังกฤษจะทำให้คำไทยขาดท่อนไม่เป็นธรรมชาติ (เช่น "กระ" "ทรวง") ต้องใช้อัลกอริทึมตัดคำภาษาไทยที่ถูกต้อง
2. **ขอบเขตกรอบคำพูดจำกัด**: กรอบคำพูดมีหลายขนาด ตัวอักษรต้องปรับขนาดอัตโนมัติ (Auto-fit) เพื่อให้อ่านง่ายที่สุดโดยไม่หลุดกรอบ
3. **ปัญหาตัวอักษรล้นกรอบ (Text Spilling/Bleed)**: หากกรอบคำพูดเป็นวงรีหรือรูปร่างแปลกๆ ตัวหนังสือที่เรนเดอร์ทรงสี่เหลี่ยมอาจล้นออกมาทับลายเส้นการ์ตูนด้านนอก

## Scope

### In scope
- คลาส `TypesettingEngine` ใน `backend/synthesis/typesetting.py`
- การคำนวณขนาดฟอนต์แบบ Auto-fit และการตัดคำไทย
- การนำ Binary Mask มาใช้ทำ Clipping ("Mask Fencing")
- การจัดการฟอนต์ภาษาไทยใน `backend/assets/fonts/`

### Out of scope
- การเรนเดอร์ข้อความแบบ 3D หรือเอฟเฟกต์อักษรวิจิตรความซับซ้อนสูง (เช่น เอฟเฟกต์เสียง Sound Effects / Onomatopoeia แปลกๆ)

## Evidence

| Claim | Classification | Evidence |
|---|---|---|
| ใช้ Pillow (`ImageDraw`, `ImageFont`) ในการเรนเดอร์ข้อความลงบนภาพ | **Fact** | `backend/synthesis/typesetting.py:40-80` |
| ใช้ PyThaiNLP สำหรับตัดคำไทย โดยมี Regex เป็นระบบสำรอง | **Fact** | `backend/synthesis/typesetting.py:95-125` |
| มีระบบคำนวณ Auto-fit ปรับขนาดฟอนต์อัตโนมัติตามพื้นที่กรอบ | **Fact** | `backend/synthesis/typesetting.py:130-165` |
| ใช้เทคโนโลยี Mask Fencing คลิปข้อความไม่ให้ล้นขอบ Mask | **Fact** | `backend/synthesis/typesetting.py:170-205` |
| มีไฟล์ฟอนต์ภาษาไทยจัดเก็บที่ `backend/assets/fonts/` (`Itim`, `NotoSansThai`) | **Fact** | `backend/assets/fonts/` |

## Decision drivers

1. **Natural Thai Typography**: คำไทยตัดได้ถูกต้องตามหลักพจนานุกรม และจัดวางกึ่งกลางกรอบอย่างสวยงาม
2. **Strict Boundary Fencing**: ตัวอักษรภาษาไทยต้องอยู่ภายในขอบเขตกรอบคำพูด 100% ห้ามล้นทับภาพการ์ตูนภายนอก
3. **High Resolution Rendering**: ตัวอักษรมีความคมชัดสูง ไม่แตกเป็นพิกเซล

## Constraints

- การคำนวณตัดคำและปรับขนาดฟอนต์แบบ Iterative ต้องทำอย่างรวดเร็วเพื่อไม่ให้ส่งผลต่อประสิทธิภาพรวมของ Pipeline

## Considered options

### Option 1: Pillow Renderer + PyThaiNLP Wrapping + Mask Fencing (เลือกตัวเลือกนี้)
- **ประโยชน์**: ตัวอักษรสวยงาม คมชัด ไม่ล้นขอบกรอบคำพูด ตัดคำไทยถูกต้อง และไม่ต้องพึ่งพา Browser/Headless Chrome ในการเรนเดอร์
- **ข้อเสีย**: ต้องดูแลไฟล์ฟอนต์ TTF ภายในโปรเจกต์
- **ความเสี่ยง**: หากไม่มี PyThaiNLP จะสลับไปใช้ Regex Chunking ซึ่งอาจตัดคำได้เนียนน้อยกว่าเล็กน้อย

### Option 2: HTML/CSS Canvas Headless Rendering (Puppeteer / Playwright)
- **ประโยชน์**: ใช้ CSS Flexbox/Grid และ Browser Font Engine ในการจัดข้อความได้ง่าย
- **ข้อเสีย**: ต้องรัน Headless Browser ซึ่งกิน Memory มหาศาลและทำงานช้ากว่า Pillow มาก

### Option 3: Fixed Font Size Rendering
- **ประโยชน์**: เขียนโค้ดง่ายที่สุด
- **ข้อเสีย**: ข้อความยาวจะล้นกรอบคำพูด ข้อความสั้นจะเล็กเกินไปอ่านไม่ออก

## Option comparison

| Criterion | Priority / Weight | Option 1 (Pillow+Fencing) | Option 2 (Headless Browser) | Option 3 (Fixed Size) |
|---|---:|---:|---:|---:|
| Rendering Speed | 5 | 5/5 | 1/5 | 5/5 |
| Mask Fencing Precision | 5 | 5/5 | 3/5 | 1/5 |
| Thai Word Wrapping Quality | 5 | 5/5 | 4/5 | 1/5 |
| Memory Footprint | 4 | 5/5 | 1/5 | 5/5 |

## Decision

เลือก **Option 1 (Pillow Renderer + PyThaiNLP + Mask Fencing)** เพื่อความเร็วในการเรนเดอร์ที่สูงมาก ใช้ทรัพยากรเครื่องน้อย และได้ตัวอักษรภาษาไทยจัดวางสละสลวยพร้อม Mask Fencing ป้องกันข้อความล้นกรอบคำพูดอย่างเป็นรูปธรรม

## Consequences

### Positive
- ได้ภาพแปลฉบับตีพิมพ์ที่ดูเป็นมืออาชีพ ตัวหนังสือจัดวางอยู่ตรงกลางกรอบคำพูดอย่างสมดุล
- ป้องกันปัญหาตัวอักษรเลื่อนล้นออกไปทับใบหน้าหรือลายเส้นของตัวละครการ์ตูน
- ทำงานได้รวดเร็วระดับมิลลิวินาทีต่อภาพ

### Negative
- ฟอนต์ที่ใช้งานต้องถูกบรรจุอยู่ในแฟ้มข้อมูล `backend/assets/fonts/`

### Risks accepted
- รองรับฟอนต์มาตรฐานภาษาไทย Itim และ NotoSansThai ซึ่งครอบคลุมอารมณ์การอ่านมังงะทั่วไปได้เป็นอย่างดี

## Implementation and migration strategy

1. ระบบคำนวณการตัดบรรทัดด้วย PyThaiNLP Dictionary
2. วนลูปสเกลขนาดฟอนต์ (Auto-fit) จนกว่าข้อความจะลงตัวในขอบเขต Bounding Box
3. เรนเดอร์อักษรลงบน Overlay Layer และประยุกต์ใช้ Binary Mask ในการ Clipping (Mask Fencing) ก่อนรวมภาพ (Composite)

## Validation

- **Automated Tests**: ทดสอบผ่าน `backend/tests/test_synthesis_regressions.py`
- **Visual Check**: ตรวจสอบภาพผลลัพธ์ในหน้า Workspace ปราศจากข้อความล้นขอบ

## Review triggers

- เมื่อต้องการเพิ่มระบบเลือกฟอนต์ภาษาไทยตามอารมณ์ตัวละคร (เช่น ฟอนต์ตะโกน ฟอนต์คิดในใจ ฟอนต์สยองขวัญ)

## References

- `docs/CODEBASE.md`
- `backend/synthesis/typesetting.py`
