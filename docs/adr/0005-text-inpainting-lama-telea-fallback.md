---
id: ADR-0005
title: ระบบลบตัวอักษรและฟื้นฟูภาพหลังฉาก (Inpainting Engine) ด้วย LaMa และ OpenCV Telea Fallback
status: Accepted
date: 2026-07-24
deciders:
  - Computer Vision Team
tags:
  - backend
  - inpainting
  - lama
  - opencv
  - image-processing
---

# ADR-0005: ระบบลบตัวอักษรและฟื้นฟูภาพหลังฉาก (Inpainting Engine) ด้วย LaMa และ OpenCV Telea Fallback

## Status

**Accepted** — ระบบลบข้อความเดิมใช้งานในโมดูล `backend/synthesis/inpainting.py`

## Decision summary

เลือกใช้ **LaMa (Large Mask Inpainting / Fast Fourier Convolutions)** ผ่านแพ็กเกจ `simple-lama-inpainting` สำหรับการลบตัวอักษรภาษาญี่ปุ่นต้นฉบับออกจากภาพการ์ตูน ร่วมกับการขยายขอบเขตหน้ากาก (Mask Dilation ขนาด 12 พิกเซล) เพื่อเก็บรายละเอียดเงาและขอบตัวอักษร พร้อมทั้งมีระบบ **OpenCV Telea Inpainting Fallback** เป็นอัลกอริทึมสำรองแบบดั้งเดิมกรณีที่ไม่มี GPU หรือแพ็กเกจ Deep Learning

## Context

การลบข้อความภาษาญี่ปุ่นออกจากกรอบคำพูดการ์ตูนเป็นขั้นตอนสำคัญก่อนการพิมพ์ข้อความภาษาไทยลงไป:
1. หากลบตัวหนังสือไม่หมด จะเหลือรอยเบลอ ขอบดำ หรือเงาอักษรเดิม (Artifacts) โผล่ออกมารอบคำแปลไทย
2. ในกรณีที่กรอบคำพูดมีลวดลายฉากหลัง (Textured Backgrounds) เช่น ฉากหลังลายจุด ลายสปีดไลน์ หรือภาพวาดการ์ตูน อัลกอริทึม Inpainting แบบเก่าจะทำให้ภาพเบลอและสูญเสียรายละเอียดฉากหลัง

การนำ Deep Learning Inpainting มาใช้จะช่วยเนียนภาพฉากหลังให้สมบูรณ์เหมือนภาพต้นฉบับที่ไม่เคยมีข้อความมาก่อน

## Scope

### In scope
- คลาส `InpaintingEngine` ใน `backend/synthesis/inpainting.py`
- การสร้างและขยาย Mask (`build_text_masks`, `dilation_px=12`)
- ระบบสลับระหว่าง LaMa Deep Learning Engine และ OpenCV Telea Fallback

### Out of scope
- การฝึกฝนโมเดล LaMa ใหม่ด้วยชุดข้อมูลภายนอก

## Evidence

| Claim | Classification | Evidence |
|---|---|---|
| ใช้ `simple-lama-inpainting` เป็น Inpainting Engine หลัก | **Fact** | `backend/synthesis/inpainting.py:35-65` |
| ใช้ OpenCV Telea (`cv2.INPAINT_TELEA`) เป็น Fallback เมื่อไร้ LaMa | **Fact** | `backend/synthesis/inpainting.py:120-145` |
| มีการขยาย Mask ด้วย Dilation (`cv2.dilate`) เพื่อลบขอบอักษรซ้อน | **Fact** | `backend/synthesis/inpainting.py:80-100` |
| จัดเก็บ preview mask ไว้ใน `uploads/masks/` สำหรับการตรวจสอบ | **Fact** | `backend/synthesis/inpainting.py:160-180` |

## Decision drivers

1. **High Visual Reconstruction Quality**: ลบตัวหนังสือภาษาญี่ปุ่นได้อย่างสะอาดเรียบเนียนโดยไม่ทิ้งรอยเบลอ
2. **Textured Background Preservation**: รักษาลวดลายสปีดไลน์และฉากหลังการ์ตูนด้านหลังตัวอักษร
3. **Graceful Degradation**: หากสภาพแวดล้อมระบบไม่มี GPU หรือติดตั้ง LaMa ไม่สำเร็จ ระบบต้องสามารถทำงานต่อได้ด้วย OpenCV

## Constraints

- LaMa โมเดลต้องการ PyTorch runtime และ VRAM ของการ์ดจอในการประมวลผล
- การใช้ Dilation มากเกินไปอาจกินพื้นที่ขอบกรอบคำพูด แต่การใช้น้อยเกินไปจะเหลือขอบตัวหนังสือเดิม

## Considered options

### Option 1: LaMa Inpainting + Mask Dilation (12px) + OpenCV Telea Fallback (เลือกตัวเลือกนี้)
- **ประโยชน์**: ให้คุณภาพภาพคลีนสวยงามที่สุด ลบตัวอักษรได้หมดจดโดยไม่ทำลายลายเส้นฉากหลัง และมีระบบสำรองป้องกันโปรแกรมค้าง
- **ข้อเสีย**: ต้องโหลดน้ำหนักโมเดล LaMa เข้าสู่ Memory
- **ความเสี่ยง**: หาก Mask ใหญ่เกินไปอาจใช้เวลาประมวลผลเพิ่มขึ้นเล็กน้อย

### Option 2: Fill White Solid Color (เติมสีขาวล้วน)
- **ประโยชน์**: ทำงานเร็วมหาศาล 0ms
- **ข้อเสีย**: ใช้ได้เฉพาะกรอบคำพูดสีขาวล้วนเท่านั้น หากเจอกรอบคำพูดที่มีฉากหลังเป็นภาพการ์ตูนหรือลวดลาย ภาพจะเสียหายทันที

### Option 3: OpenCV Telea / Navier-Stokes อย่างเดียว
- **ประโยชน์**: ไม่ต้องใช้ GPU / Deep Learning Model
- **ข้อเสีย**: ทิ้งรอยเบลอ (Blur Artifacts) ชัดเจนเมื่อพื้นที่ตัวหนังสือมีขนาดใหญ่

## Option comparison

| Criterion | Priority / Weight | Option 1 (LaMa + Telea) | Option 2 (Solid White) | Option 3 (OpenCV Only) |
|---|---:|---:|---:|---:|
| Inpainting Visual Quality | 5 | 5/5 | 1/5 | 3/5 |
| Textured Background Support | 5 | 5/5 | 1/5 | 2/5 |
| Reliability & Fallback | 4 | 5/5 | 5/5 | 5/5 |
| Speed | 3 | 4/5 | 5/5 | 5/5 |

## Decision

เลือก **Option 1 (LaMa + Mask Dilation 12px + OpenCV Telea Fallback)** เพราะให้คุณภาพลบข้อความที่สวยงามและเนียนที่สุดในอุตสาหกรรมปัจจุบัน เหมาะสำหรับงานแปลมังงะคุณภาพสูง โดยยังคงรักษาความเสถียรของระบบด้วยระบบสำรอง OpenCV

## Consequences

### Positive
- ลบข้อความภาษาญี่ปุ่นต้นฉบับได้สะอาด 100% ปราศจากรอยเงาตัวอักษรเดิม
- ฉากหลังที่มีลายสปีดไลน์หรือลวดลายการ์ตูนได้รับการฟื้นฟูอย่างสมจริง
- ระบบสามารถประมวลผลภาพต่อได้แม้เครื่องผู้ใช้จะไม่มี GPU ผ่าน OpenCV Fallback

### Negative
- ต้องใช้เวลาประมวลผลเพิ่มเติมประมาณ 200ms - 800ms ต่อภาพ

### Risks accepted
- กำหนดค่า Dilation เริ่มต้นไว้ที่ 12px ซึ่งครอบคลุมตัวอักษรและเงามังงะมาตรฐานได้ครอบคลุมที่สุด

## Implementation and migration strategy

1. ระบบสกัด Mask ตัวอักษรและทำ Dilation ขยายขอบ 12 พิกเซล
2. ส่งภาพและ Mask เข้าสู่ LaMa Engine หากล้มเหลวจะสลับไปยัง OpenCV Telea โดยอัตโนมัติ
3. บันทึกภาพผลลัพธ์การคลีนภาพไว้ในแฟ้มข้อมูล `uploads/`

## Validation

- **Automated Tests**: ทดสอบกระบวนการ Inpainting และ Regression ผ่าน `backend/tests/test_synthesis_regressions.py`
- **Visual Validation**: เปรียบเทียบภาพ Original vs Cleaned ในหน้าจอ Frontend

## Review triggers

- เมื่อมีเทคโนโลยี Inpainting รุ่นใหม่ที่เร็วขึ้นและรองรับภาพความละเอียดสูงระดับ 4K

## References

- `docs/CODEBASE.md`
- `backend/synthesis/inpainting.py`
