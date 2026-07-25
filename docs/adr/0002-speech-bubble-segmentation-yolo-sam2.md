---
id: ADR-0002
title: ระบบตรวจจับและแยกพื้นที่กรอบคำพูด (Speech Bubble Segmentation) ด้วย YOLOv11 และ SAM 2
status: Accepted
date: 2026-07-24
deciders:
  - Computer Vision Team
tags:
  - backend
  - computer-vision
  - segmentation
  - yolo
  - sam2
---

# ADR-0002: ระบบตรวจจับและแยกพื้นที่กรอบคำพูด (Speech Bubble Segmentation) ด้วย YOLOv11 และ SAM 2

## Status

**Accepted** — ระบบ Two-Stage Segmentation ปัจจุบันใช้งานในโมดูล `backend/synthesis/segmentation.py`

## Decision summary

เลือกใช้สถาปัตยกรรมประมวลผลสองขั้นตอน (Two-Stage Pipeline) โดยใช้ **YOLOv11** ในการค้นหาตำแหน่งกรอบคำพูด (Speech Bubble Detection & Bounding Box) และตามด้วย **Segment Anything Model 2 (SAM 2)** ในการสกัดพิกเซลของกรอบคำพูด (Pixel-level Fine Mask Generation) พร้อมรองรับระบบสำรอง (Fallback) เป็น Bounding Box Mask หาก SAM 2 ไม่สามารถทำงานได้

## Context

ภาพมังงะและโดจินชิมีกรอบคำพูดหลากหลากรูปแบบ ทั้งกรอบวงกลม กรอบวงรี กรอบสี่เหลี่ยม ขอบฟันปลา (Action Bubbles) หรือกรอบแบบไม่มีเส้นขอบ (Implicit/Unbounded Text Areas) การใช้ Bounding Box แบบสี่เหลี่ยมอย่างเดียวในการลบข้อความหรือเรนเดอร์ข้อความ มักจะครอบคลุมเกินขอบเขตภาพการ์ตูนจริง ทำให้เส้นลายเส้นการ์ตูนเดิมเสียหาย (Artwork Bleed Error)

ดังนั้นระบบต้องการเครื่องมือสกัด Mask ที่มีความแม่นยำสูงระดับพิกเซล เพื่อแยกเฉพาะพื้นที่ด้านในกรอบคำพูดโดยไม่ทำลายลายเส้นการ์ตูนรอบนอก

## Scope

### In scope
- การโหลดโมเดลและประมวลผลภาพใน `backend/synthesis/segmentation.py`
- การบริหารจัดการ GPU VRAM สำหรับ YOLOv11 (`yolo11n-seg.pt`) และ SAM 2 (`sam2_b.pt`)
- ระบบ Fallback จาก SAM 2 เป็น Bounding Box Rectangular Mask

### Out of scope
- การฝึกฝน (Training) โมเดล YOLO หรือ SAM 2 ใหม่จากรอยขีดข่วน (Scratch)
- การประมวลผล Video Stream

## Evidence

| Claim | Classification | Evidence |
|---|---|---|
| ใช้ YOLOv11 (`yolo11n-seg.pt` หรือ `best.pt`) ตรวจจับกรอบคำพูด | **Fact** | `backend/synthesis/segmentation.py:45-75` |
| ใช้ SAM 2 (`sam2_b.pt`) ปรับปรุงความคมชัดระดับพิกเซลของ Mask | **Fact** | `backend/synthesis/segmentation.py:110-160` |
| มีระบบ Fallback เป็น Bounding Box Mask หาก SAM 2 ล้มเหลว | **Fact** | `backend/synthesis/segmentation.py:170-195` |
| มีระบบคืน VRAM ด้วย `unload_all()` และ `torch.cuda.empty_cache()` | **Fact** | `backend/synthesis/segmentation.py:210-235` |

## Decision drivers

1. **Pixel-Accurate Mask Precision**: ป้องกันการลบภาพลายเส้นการ์ตูนที่อยู่นอกกรอบคำพูด
2. **VRAM Efficiency on Consumer Hardware**: ต้องสามารถรันโมเดลบนการ์ดจอระดับผู้ใช้ทั่วไป (เช่น RTX 4060 8GB VRAM) ได้
3. **Pipeline Fault Tolerance**: หากโมเดลระดับสูงประมวลผลล้มเหลว ระบบต้องไม่พัง แต่สามารถใช้วิธีสำรองสกัดภาพต่อไปได้

## Constraints

- การรัน SAM 2 ใช้ทรัพยากร GPU และเวลาเพิ่มขึ้นเมื่อเทียบกับ YOLO อย่างเดียว
- VRAM ของผู้ใช้มีจำกัด ต้องโหลดและถอดโมเดลออกจากหน่วยความจำเมื่อประมวลผลเสร็จ

## Considered options

### Option 1: Two-Stage Hybrid (YOLOv11 + SAM 2) พร้อม Fallback (เลือกตัวเลือกนี้)
- **ประโยชน์**: ได้ Mask ที่คมกริบเข้ารูปกับกรอบคำพูดทุกประเภท ลดปัญหาภาพเลอะ และมี fallback ป้องกันระบบค้าง
- **ข้อเสีย**: ต้องโหลดไฟล์น้ำหนักโมเดล 2 ตัว (`yolo11n-seg.pt` และ `sam2_b.pt`)
- **ความเสี่ยง**: ใช้เวลาประมวลผลต่อหน้าเพิ่มขึ้นเล็กน้อย (ประมาณ 0.5 - 1.2 วินาที)

### Option 2: YOLO Rectangular Bounding Box อย่างเดียว
- **ประโยชน์**: ประมวลผลเร็วที่สุด ใช้ VRAM น้อยมาก
- **ข้อเสีย**: กรอบสี่เหลี่ยมจะกินพื้นที่ลายเส้นการ์ตูนภายนอก ส่งผลให้ขั้นตอน Inpainting ลบภาพการ์ตูนเกินจำเป็น

### Option 3: Manual Mask Drawing เพียงอย่างเดียว
- **ประโยชน์**: ผู้ใช้ควบคุมได้ 100%
- **ข้อเสีย**: ทำลายวัตถุประสงค์ของระบบอัตโนมัติ (Automated Scanlation)

## Option comparison

| Criterion | Priority / Weight | Option 1 (YOLO+SAM2) | Option 2 (YOLO Only) | Option 3 (Manual Only) |
|---|---:|---:|---:|---:|
| Mask Quality & Detail | 5 | 5/5 | 2/5 | 5/5 |
| Processing Speed | 4 | 4/5 | 5/5 | 1/5 |
| Automation Level | 5 | 5/5 | 5/5 | 1/5 |
| VRAM Management Safety | 4 | 4/5 | 5/5 | 5/5 |

## Decision

เลือก **Option 1 (Two-Stage Hybrid: YOLOv11 + SAM 2)** เพราะให้คุณภาพ Mask ดีที่สุด ช่วยปกป้องลายเส้นการ์ตูนต้นฉบับในขั้นตอน Inpainting และคงความสามารถในการสลับใช้ Bounding Box Fallback ในกรณีที่ทรัพยากรเครื่องไม่เพียงพอ

## Consequences

### Positive
- ได้ Mask ที่พอดีกับขอบกรอบคำพูดแบบซับซ้อน (รวมถึงกรอบ Action สองมิติ)
- ขั้นตอน Inpainting ทำงานได้เนียนเรียบขึ้น เนื่องจากไม่ต้องลบพื้นที่ส่วนเกิน
- VRAM ถูกคืนค่าหลังการสกัดภาพเสร็จสิ้น ทำให้ GPU มีพื้นที่เพียงพอสำหรับขั้นตอนถัดไป

### Negative
- ต้องใช้พื้นที่ดิสก์จัดเก็บไฟล์ Weight ของโมเดล SAM 2 เพิ่มขึ้น (`sam2_b.pt` ประมาณ 160MB)

### Risks accepted
- SAM 2 อาจล้มเหลวในภาพที่มีความละเอียดต่ำมาก แต่นำเอา Bounding Box Fallback มาแก้ปัญหาความเสี่ยงนี้แล้ว

## Implementation and migration strategy

1. YOLOv11 ทำหน้าที่ Detect ตำแหน่งกรอบคำพูดและสร้าง Candidate Bounding Boxes
2. Candidate Boxes ถูกส่งต่อไปยัง SAM 2 Predictor เพื่อสร้าง Binary Mask (`uint8` numpy array)
3. เรียกฟังก์ชัน `unload_sam2()` เพื่อล้าง VRAM เมื่อจบ Stage

## Validation

- **Automated Tests**: ทดสอบการทำงานและการถอดโมเดลผ่าน `backend/tests/test_synthesis_regressions.py`
- **Success Signal**: สร้าง `TextBlock` พร้อม Mask และ Bounding Box ที่แม่นยำ

## Review triggers

- เมื่อมีโมเดล Segmentation แบบ Single-stage รุ่นใหม่ที่เล็กลงและแม่นยำเทียบเท่า SAM 2

## References

- `docs/CODEBASE.md`
- `backend/synthesis/segmentation.py`
