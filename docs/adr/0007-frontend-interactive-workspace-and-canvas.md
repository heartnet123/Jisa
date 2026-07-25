---
id: ADR-0007
title: การออกแบบสถาปัตยกรรม UI Dashboard หน้าจอแก้ไข Canvas และการซิงค์สถานะแบบ Real-time (Frontend Workspace UI)
status: Accepted
date: 2026-07-24
deciders:
  - Frontend Team
tags:
  - frontend
  - nextjs
  - react
  - canvas
  - sse
  - ui-ux
---

# ADR-0007: การออกแบบสถาปัตยกรรม UI Dashboard หน้าจอแก้ไข Canvas และการซิงค์สถานะแบบ Real-time (Frontend Workspace UI)

## Status

**Accepted** — ใช้งานจริงในโมดูล `frontend/app/` และ `frontend/src/features/manga-translator/`

## Decision summary

เลือกใช้ **Next.js 16 (React 19)** สถาปัตยกรรม Decoupled SPA ร่วมกับ **HTML5 Interactive Canvas (`RegionCanvas.tsx`)** สำหรับระบบแก้ไขพื้นที่กรอบคำพูด (Human-in-the-Loop Gate), **Side-by-side Image Inspector** สำหรับเปรียบเทียบภาพต้นฉบับกับภาพแปล, และ **Server-Sent Events (SSE) Synchronization** สำหรับการติดตามสถานะงานประมวลผลพื้นหลังเรียลไทม์

## Context

ผู้ใช้งานระบบ AI Manga Translator ต้องการเครื่องมือที่มีความยืดหยุ่นสูง:
1. การตรวจจับ AI อาจมีข้อผิดพลาดบางจุด ผู้ใช้ต้องสามารถลากขยาย ปรับขนาด ย้าย หรือเพิ่มกรอบคำพูดด้วยตนเองผ่านหน้าเว็บได้สะดวก (Human-in-the-Loop Editor)
2. ผู้ใช้ต้องการดูเปรียบเทียบผลลัพธ์แบบข้างต่อข้าง (Original vs. Cleaned vs. Translated) เพื่อตรวจสอบความถูกต้องของการแปลและลายเส้น
3. กระบวนการแปลใช้เวลาประมวลผลพื้นหลัง ผู้ใช้ต้องเห็นความคืบหน้า (Progress Bar / Phase Indicator) แบบเรียลไทม์โดยไม่ต้องคอยกด Refresh หน้าจอ

## Scope

### In scope
- โครงสร้าง App Router ใน `frontend/app/(workspace)/`
- โมดูลสถาปัตยกรรม `frontend/src/features/manga-translator/` (`components/`, `context/`, `api/`, `types/`)
- หน้าจอ Canvas interactive editor (`RegionCanvas.tsx`) และสภาพแวดล้อมจัดการ State (`MangaTranslatorContext.tsx`)

### Out of scope
- Server-Side Rendering (SSR) ของภาพมังงะ (เน้น Client-side interactive workspace)

## Evidence

| Claim | Classification | Evidence |
|---|---|---|
| ใช้ Next.js 16 (React 19) และ Tailwind CSS v4 | **Fact** | `frontend/package.json` |
| มีหน้าจอ Canvas Editor สำหรับย้าย/ปรับขนาด/เพิ่มกรอบคำพูด | **Fact** | `frontend/src/features/manga-translator/components/RegionCanvas.tsx` |
| มีระบบเปรียบเทียบภาพ Original vs Cleaned vs Typeset แบบ Side-by-side | **Fact** | `frontend/src/features/manga-translator/components/ProjectWorkspace.tsx` |
| รับข่าวสารสถานะงานแบบเรียลไทม์ผ่าน SSE Event Source | **Fact** | `frontend/src/features/manga-translator/api/mangaApi.ts` |
| ทดสอบ UI Components ผ่าน Vitest | **Fact** | `frontend/vitest.config.ts` |

## Decision drivers

1. **High Interactive Canvas Responsiveness**: ผู้ใช้ต้องแก้ไข Bounding Box บนหน้าเว็บได้ลื่นไหล 60 FPS
2. **Instant Visual Feedback**: เห็นความแตกต่างของภาพก่อนและหลังแปลชัดเจน
3. **Seamless Multi-page Workspace**: จัดการชุดภาพในโปรเจกต์ เรียงลำดับ และติดตามสถานะได้ในหน้าเดียว

## Constraints

- การสเกลพิกเซลบน Canvas ต้องสัมพันธ์กับความละเอียดภาพจริง (Natural Image Scale Factor) เพื่อให้พิกเซล Bounding Box ที่ส่งกลับ Backend มีความแม่นยำสูง

## Considered options

### Option 1: Next.js 16 App Router + HTML5 Canvas + SSE State Context (เลือกตัวเลือกนี้)
- **ประโยชน์**: ประสิทธิภาพ Canvas สูงมาก ปรับแต่งระบบ Drag-and-Drop ได้อิสระ, รับ Event เรียลไทม์จาก Backend โดยไม่สิ้นเปลือง Bandwidth, ตอบสนองรวดเร็ว
- **ข้อเสีย**: ต้องคำนวณพิกเซลพิกัดบน Canvas (Coordinate System Transformation) อย่างระมัดระวัง
- **ความเสี่ยง**: ต้องจัดการ Memory บน Browser กรณีที่ผู้ใช้อัปโหลดภาพขนาดใหญ่จำนวนมาก

### Option 2: Pure HTML DOM Bounding Boxes (Div Elements บนภาพ)
- **ประโยชน์**: เขียนง่าย ใช้ absolute positioning
- **ข้อเสีย**: เมื่อมีกรอบคำพูดจำนวนมาก (เช่น 30+ กรอบในหน้าเดียว) DOM Elements จะช้าและกระตุกเมื่อลากปรับขนาด

### Option 3: Standard HTTP Polling (เรียก GET /status ทุก 1 วินาที)
- **ประโยชน์**: Implement ฝั่ง Client ง่าย
- **ข้อเสีย**: สร้าง Traffic ขยะจำนวนมากบนเซิร์ฟเวอร์ และเกิดความล่าช้าในการอัปเดตสถานะ

## Option comparison

| Criterion | Priority / Weight | Option 1 (Canvas + SSE) | Option 2 (DOM Divs) | Option 3 (Polling) |
|---|---:|---:|---:|---:|
| Interactive Canvas Performance | 5 | 5/5 | 2/5 | 5/5 |
| Real-time Update Efficiency | 5 | 5/5 | 5/5 | 2/5 |
| Coordinate Accuracy | 4 | 5/5 | 3/5 | 5/5 |
| Modern UX / Wow Factor | 4 | 5/5 | 3/5 | 3/5 |

## Decision

เลือก **Option 1 (Next.js 16 App Router + HTML5 Canvas + SSE)** เพื่อให้ผู้ใช้ได้รับประสบการณ์ระดับพรีเมียม แก้ไขกรอบคำพูดได้แม่นยำลื่นไหล และติดตามการทำงานของระบบ AI ได้อย่างเรียลไทม์

## Consequences

### Positive
- หน้าจอ Workspace ตอบสนองรวดเร็ว สามารถ Drag & Resize กรอบคำพูดได้อย่างแม่นยำ
- การเปรียบเทียบภาพ Side-by-Side ช่วยให้ผู้ใช้ตรวจสอบความเนียนของการลบตัวหนังสือและการจัดวางภาษาไทยได้ทันที
- การสื่อสาร SSE ทำให้สถานะ UI อัปเดตทันทีเมื่อขั้นตอน AI แต่ละ Stage ทำงานเสร็จ

### Negative
- ต้องมีการทดสอบความถูกต้องของ UI Components ผ่าน Vitest เพื่อป้องกัน Regression

### Risks accepted
- พิกัดบน Canvas ถูกแปลงกลับเป็น Original Image Coordinates ผ่าน Scaling Factor อย่างแม่นยำก่อนส่ง API

## Implementation and migration strategy

1. สร้าง `MangaTranslatorContext` ควบคุม Global State ในหน้า Workspace
2. `RegionCanvas.tsx` ทำหน้าที่เรนเดอร์ภาพและวาด Rectangle Overlays บน HTML5 Canvas 2D Context
3. เชื่อมต่อ SSE Event Source สตรีมข้อมูลจาก Backend และอัปเดตสถานะใน React State

## Validation

- **Automated Tests**: ทดสอบผ่าน `frontend/vitest.config.ts`
- **User Verification**: ทดสอบการลากขยายขอบเขต Bounding Box และกด Approve เพื่อประมวลผลต่อ

## Review triggers

- เมื่อต้องการรองรับการวาด Mask แบบ Freehand Polygon สดบน Browser Canvas

## References

- `docs/CODEBASE.md`
- `frontend/src/features/manga-translator/components/RegionCanvas.tsx`
- `frontend/src/features/manga-translator/components/ProjectWorkspace.tsx`
- `frontend/src/features/manga-translator/context/MangaTranslatorContext.tsx`
