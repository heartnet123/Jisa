---
id: ADR-0003
title: การดึงข้อความภาษาญี่ปุ่นจากกรอบคำพูดด้วย Local Vision-Language Model ผ่าน Ollama
status: Accepted
date: 2026-07-24
deciders:
  - AI & OCR Team
tags:
  - backend
  - ocr
  - vlm
  - ollama
  - japanese-text
---

# ADR-0003: การดึงข้อความภาษาญี่ปุ่นจากกรอบคำพูดด้วย Local Vision-Language Model ผ่าน Ollama

## Status

**Accepted** — ระบบใช้อ่านตัวอักษรญี่ปุ่นในโมดูล `backend/main.py` ผ่าน Ollama Local Server

## Decision summary

เลือกใช้ **Local Vision-Language Model (VLM)** เช่น `GLM-OCR` หรือ `Llama-OCR` ที่รันบนเซิร์ฟเวอร์ **Ollama (HTTP Port 11434)** สำหรับการอ่านอักษรภาษาญี่ปุ่น (Kanji, Hiragana, Katakana) แนวตั้งและแนวนอนจากกรอบคำพูด โดยมีกระบวนการอ่านแบบรายกรอบคำพูด (Bubble-level OCR) ร่วมกับระบบอ่านทั้งหน้าเพจเป็นสำรอง (Full-page OCR Fallback)

## Context

ข้อความในมังงะญี่ปุ่นมีความท้าทายสูงต่อระบบ OCR ทั่วไป (เช่น Tesseract):
1. ข้อความส่วนใหญ่จัดวางในแนวตั้ง (Vertical Japanese Text) จากขวาไปซ้าย
2. มีการผสมอักษร Furigana ขนาดเล็กอยู่เหนือตัวอักษร Kanji
3. ตัวอักษรบิดเบี้ยวตามสไตล์ลายมือ (Manga Handwriting Fonts) หรือมีเอฟเฟกต์ประดับ

การใช้ Cloud OCR (เช่น Google Cloud Vision) มีค่าใช้จ่ายต่อภาพและต้องการการเชื่อมต่ออินเทอร์เน็ตตลอดเวลา การใช้ Local VLM ผ่าน Ollama จึงตอบโจทย์เรื่องความแม่นยำและการทำงานแบบ Local-first

## Scope

### In scope
- ฟังก์ชัน `_perform_ocr(image_np, blocks)` ใน `backend/main.py`
- การเชื่อมต่อกับ Ollama HTTP API (`http://localhost:11434`)
- ตรวจสอบสถานะการเชื่อมต่อผ่าน `/api/ollama/status`

### Out of scope
- การคอมไพล์หรือโฮสต์ระบบ VLM inference engine ขึ้นมาเองจาก C++ source (ใช้อินเทอร์เฟซมาตรฐานของ Ollama)

## Evidence

| Claim | Classification | Evidence |
|---|---|---|
| เรียกใช้ Ollama API ที่ `http://localhost:11434` ด้วย model `GLM-OCR` / `Llama-OCR` | **Fact** | `backend/main.py:66-67, 405-435` |
| ตัดภาพตาม Bounding Box เพื่อส่งให้ VLM อ่านข้อความรายกรอบ | **Fact** | `backend/main.py:410-425` |
| มีระบบตรวจสอบสถานะ Ollama ผ่าน Endpoint `/api/ollama/status` | **Fact** | `backend/main.py:210-230` |
| จัดการข้อผิดพลาด OCR ผ่าน `OcrError` exception | **Fact** | `backend/job_errors.py:1-15` |

## Decision drivers

1. **High Accuracy on Vertical Japanese & Furigana**: VLM สมัยใหม่สามารถเข้าใจโครงสร้างประโยคภาษาญี่ปุ่นแนวตั้งและตัด Furigana ออกได้ดีกว่า Rule-based OCR
2. **Local Privacy & Offline Availability**: ประมวลผลบนเครื่องผู้ใช้ทั้งหมด โดยไม่ส่งรูปภาพขึ้น Cloud ภายนอก
3. **Ecosystem Integration**: Ollama เป็นมาตรฐานเปิดสำหรับรัน Local Models ที่ผู้ใช้สามารถติดตั้งและสลับโมเดล OCR ได้สะดวก

## Constraints

- เครื่องของผู้ใช้ต้องมีการติดตั้งบริการ Ollama และดาวน์โหลดโมเดล OCR ไว้ล่วงหน้า
- การประมวลผล VLM ต้องใช้ทรัพยากร GPU/RAM ของเครื่อง

## Considered options

### Option 1: Local VLM ผ่าน Ollama HTTP Client (เลือกตัวเลือกนี้)
- **ประโยชน์**: อ่านอักษรแนวตั้งและลายมือมังงะได้แม่นยำสูง, รองรับการสลับโมเดล VLM ใหม่ๆ ในอนาคตได้ง่ายผ่าน Ollama, เป็น Local-first 100%
- **ข้อเสีย**: ผู้ใช้ต้องรัน Ollama background process ไว้บนเครื่อง
- **ความเสี่ยง**: หาก Ollama ไม่ถูกเปิดใช้งาน ระบบจะส่ง `OcrError` แจ้งเตือนผู้ใช้

### Option 2: Traditional Engine (Tesseract OCR / Manga-OCR native)
- **ประโยชน์**: ไม่ต้องลง Ollama
- **ข้อเสีย**: Tesseract อ่านภาษาญี่ปุ่นแนวตั้งและ Furigana ได้แย่มาก ส่วน Manga-OCR นำเข้าไลบรารี PyTorch ซ้ำซ้อนและตั้งค่ายากกว่า

### Option 3: Cloud OCR Service (Google Cloud Vision API)
- **ประโยชน์**: ไม่ต้องใช้ GPU ในเครื่อง
- **ข้อเสีย**: มีค่าใช้จ่ายต่อภาพ ต้องใช้อินเทอร์เน็ต ละเมิดหลักการ Local-first

## Option comparison

| Criterion | Priority / Weight | Option 1 (Ollama VLM) | Option 2 (Tesseract) | Option 3 (Cloud API) |
|---|---:|---:|---:|---:|
| Vertical Japanese Accuracy | 5 | 5/5 | 1/5 | 4/5 |
| Local Privacy & Offline | 5 | 5/5 | 5/5 | 1/5 |
| Zero Extra Cost | 4 | 5/5 | 5/5 | 2/5 |
| Operational Simplicity | 3 | 4/5 | 3/5 | 4/5 |

## Decision

เลือก **Option 1 (Local VLM ผ่าน Ollama)** เนื่องจากเป็นแนวทางที่ให้ผลลัพธ์การอ่านข้อความภาษาญี่ปุ่นแนวตั้งในมังงะได้แม่นยำที่สุด สอดคล้องกับแนวคิด Local-first และมีความยืดหยุ่นในการอัปเกรดโมเดล Vision ในอนาคต

## Consequences

### Positive
- อ่านตัวอักษรภาษาญี่ปุ่นแนวตั้งและประโยคที่มีความซับซ้อนได้อย่างแม่นยำ
- ป้องกันการดึงตัวอักษร Furigana ซ้ำซ้อนเข้ามารวมในประโยคหลัก
- ระบบสามารถตรวจสอบความพร้อมของ Ollama ได้ง่ายผ่าน Endpoint Health Check

### Negative
- ต้องมีข้อแนะนำผู้ใช้ในการติดตั้งและดาวน์โหลดโมเดล Ollama (`ollama run GLM-OCR`) ก่อนเริ่มใช้งาน

### Risks accepted
- ความเร็วในการอ่านขึ้นอยู่กับความสามารถของ GPU/CPU เครื่องผู้ใช้

## Implementation and migration strategy

1. ระบบส่ง Base64 Cropped Image ของแต่ละ Bubble ไปยัง Ollama API
2. หากผลลัพธ์เป็นข้อความว่างเปล่า ระบบจะลองรัน Full-page OCR เพื่อค้นหาตัวอักษรที่ตกหล่น

## Validation

- **Automated Tests**: ทดสอบ API Exception Handling ผ่าน `backend/tests/test_synthesis_regressions.py`
- **Manual Check**: ตรวจสอบการเชื่อมต่อที่ `/api/ollama/status` ให้คืนค่า `status: ok`

## Review triggers

- เมื่อมีโมเดล OCR ชนิดลีน (Lightweight Native OCR Model) ที่แม่นยำกว่า VLM และไม่พึ่งพา Ollama

## References

- `docs/CODEBASE.md`
- `backend/main.py`
- `backend/job_errors.py`
