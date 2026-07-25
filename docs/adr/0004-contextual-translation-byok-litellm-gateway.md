---
id: ADR-0004
title: ระบบแปลภาษาญี่ปุ่นเป็นไทยเชิงบริบทด้วย BYOK LLM Gateway ผ่าน LiteLLM
status: Accepted
date: 2026-07-24
deciders:
  - AI & Translation Team
tags:
  - backend
  - translation
  - litellm
  - byok
  - llm-gateway
---

# ADR-0004: ระบบแปลภาษาญี่ปุ่นเป็นไทยเชิงบริบทด้วย BYOK LLM Gateway ผ่าน LiteLLM

## Status

**Accepted** — ใช้งานจริงในโมดูล `backend/byok.py` และ `backend/main.py`

## Decision summary

เลือกใช้ **LiteLLM** เป็น Unified LLM Gateway ในรูปแบบ **Bring Your Own Key (BYOK)** ซึ่งเปิดให้ผู้ใช้กำหนด API Key และเลือกผู้ให้บริการ AI Model ที่ต้องการได้เอง (OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek หรือ Local Ollama) โดยระบบส่งข้อความแปลแบบยกหน้าเพจ (Page-level Context Prompting) เพื่อรักษาความต่อเนื่องของบทสนทนา สรรพนาม และอารมณ์ของตัวละครมังงะภาษาไทย

## Context

การแปลมังงะภาษาญี่ปุ่นเป็นภาษาไทย มีความละเอียดอ่อนทางด้านภาษาศาสตร์สูง:
1. การแปลแบบคำต่อคำหรือประโยคต่อประโยค (Bubble-by-Bubble) ทำให้หลุดบริบท สรรพนามตัวละคร (เช่น "ฉัน", "ผม", "ข้า", "นาย") เปลี่ยนไปมาในหน้าเดียวกัน
2. คำลงท้ายและคำยกย่องภาษาญี่ปุ่น (Honorifics เช่น -san, -chan, -sama) ต้องปรับเป็นคำแปลไทยที่เป็นธรรมชาติ
3. ผู้ใช้แต่ละคนมีความชอบผู้ให้บริการ LLM และงบประมาณ API ที่แตกต่างกัน

การผูกติดระบบเข้ากับ Vendor รายใดรายหนึ่ง (Vendor Lock-in) จะลดความยืดหยุ่นของผู้ใช้

## Scope

### In scope
- ฟังก์ชันจัดการ BYOK Gateway ใน `backend/byok.py`
- การส่งคำสั่งแปลพร้อม System Prompt ใน `backend/main.py`
- Endpoints สำหรับตรวจสอบและตั้งค่า BYOK: `/api/byok/providers` และ `/api/byok/test`

### Out of scope
- การสร้างตัวประมวลผล LLM ขึ้นมาเองจากรอยขีดข่วน
- การจัดการระบบเติมเงิน / Billing ภายในแอปพลิเคชัน (ผู้ใช้ชำระเงินกับ Provider โดยตรง)

## Evidence

| Claim | Classification | Evidence |
|---|---|---|
| ใช้ LiteLLM เป็น Unified SDK ในการสื่อสารกับ Multi-provider LLMs | **Fact** | `backend/byok.py:15-80` |
| รองรับ Provider Presets: OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, Ollama | **Fact** | `backend/byok.py:30-65`, `backend/main.py:240-270` |
| รับค่า API Key ผ่าน HTTP Headers (`x-byok-api-key`, `x-byok-provider`, `x-byok-model`) หรือ Environment Variables | **Fact** | `backend/byok.py:90-120` |
| ส่งข้อความแปลทั้งหน้าพร้อมกัน (Page-level Context Prompt) | **Fact** | `backend/main.py:445-490` |
| มีการทดสอบความถูกต้องผ่าน `backend/tests/test_byok.py` | **Fact** | `backend/tests/test_byok.py` |

## Decision drivers

1. **User Freedom & Cost Control (BYOK)**: ผู้ใช้ควบคุมค่าใช้จ่าย API Key ของตนเอง และเลือกรุ่นโมเดลที่ต้องการได้ทันที
2. **Context-Aware Translation Quality**: การแปลมังงะต้องใช้บริบททั้งหน้าเพจเพื่อให้ได้สำนวนการ์ตูนไทยที่ไหลลื่น
3. **Unified API Abstraction**: โค้ดฝั่ง Backend ใช้ interface เดียวในการเรียกใช้ LLM ทุกค่ายโดยไม่ต้องเขียน SDK แยก

## Constraints

- โครงสร้าง JSON Output จาก LLM ต้องได้รับการตรวจสอบความถูกต้อง (Schema Validation) เพื่อให้ได้จำนวนประโยคแปลตรงกับจำนวน Bubble ในหน้าเพจ

## Considered options

### Option 1: LiteLLM Unified Gateway + Page-level Prompting (เลือกตัวเลือกนี้)
- **ประโยชน์**: เขียนโค้ดเชื่อมต่อชุดเดียวรองรับ LLM กว่า 100+ รุ่น, ผู้ใช้สลับ Provider ได้อิสระ, แปลได้สละสลวยเพราะเห็นบริบททั้งหน้า
- **ข้อเสีย**: ขึ้นอยู่กับไลบรารี LiteLLM สำหรับการอัปเดต API Endpoint ของแต่ละค่าย
- **ความเสี่ยง**: หาก Provider บางค่ายส่งคืน JSON Format ไม่ตรงตามสั่ง ต้องมีระบบ Fallback / Retry

### Option 2: Direct Official SDKs (OpenAI SDK + Anthropic SDK + Google GenAI SDK แยกกัน)
- **ประโยชน์**: ไม่ต้องพึ่งพาแพ็กเกจกลางอย่าง LiteLLM
- **ข้อเสีย**: เกิด Code Duplication สูง ต้องดูแลและอัปเดต SDK หลายตัวพร้อมกัน

### Option 3: Hardcoded Single Provider (เช่น OpenAI อย่างเดียว)
- **ประโยชน์**: ง่ายต่อการพัฒนาในระยะแรก
- **ข้อเสีย**: ผู้ใช้ที่ไม่มี OpenAI API Key หรือต้องการใช้ DeepSeek / Claude / Gemini จะไม่สามารถใช้งานระบบได้

## Option comparison

| Criterion | Priority / Weight | Option 1 (LiteLLM BYOK) | Option 2 (Direct SDKs) | Option 3 (Single Provider) |
|---|---:|---:|---:|---:|
| Multi-Provider Flexibility | 5 | 5/5 | 4/5 | 1/5 |
| Maintenance Overhead | 4 | 5/5 | 2/5 | 5/5 |
| Context-Aware Translation | 5 | 5/5 | 5/5 | 5/5 |
| Zero Vendor Lock-in | 4 | 5/5 | 4/5 | 1/5 |

## Decision

เลือก **Option 1 (LiteLLM Unified Gateway + BYOK)** เพราะสร้างสถาปัตยกรรมที่เปิดกว้าง ให้เสรีภาพแก่ผู้ใช้ในการเลือก AI Provider และช่วยให้โค้ดฝั่ง Backend สะอาด บำรุงรักษาง่าย

## Consequences

### Positive
- สลับใช้งานโมเดลราคาถูกหรือโมเดลประสิทธิภาพสูง (เช่น GPT-4o, Claude 3.5 Sonnet, Gemini 2.5 Flash, DeepSeek-V3) ได้ตามต้องการ
- สามารถใช้งาน Local LLM ผ่าน Ollama ได้โดยไม่ต้องเสียค่าบริการ API ภายนอก
- บริบทสำนวนไทยและสรรพนามตัวละครมีความสม่ำเสมอทั้งหน้าเพจ

### Negative
- ต้องเพิ่มขั้นตอนตรวจสอบการเชื่อมต่อ Key API ในหน้า Frontend ก่อนเริ่มงานแปล

### Risks accepted
- ความเร็วและอัตรา Limit (Rate Limits) ขึ้นอยู่กับข้อกำหนดของ Provider ที่ผู้ใช้เลือก

## Implementation and migration strategy

1. Frontend ส่ง Custom Headers หรือตั้งค่าในแผงควบคุมระบบ
2. `byok.py` ทำการ Normalize Parameter และเรียกใช้ `litellm.completion()`
3. Parse ผลลัพธ์ภาษาไทยและแมปกลับเข้าสู่ `TextBlock.translated_text`

## Validation

- **Automated Tests**: ทดสอบการทำงานของ BYOK Gateway ผ่าน `backend/tests/test_byok.py`
- **Success Signal**: Endpoint `/api/byok/test` ตอบกลับสำเร็จ และแปลงภาษาญี่ปุ่นเป็นไทยได้อย่างถูกต้อง

## Review triggers

- เมื่อมีมาตรฐานการเชื่อมต่อ LLM API ใหม่ที่เป็นอุตสาหกรรม หรือต้องการเพิ่ม Local LLM Engine เพิ่มเติม

## References

- `docs/CODEBASE.md`
- `backend/byok.py`
- `backend/main.py`
- `backend/tests/test_byok.py`
