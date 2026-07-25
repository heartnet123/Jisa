---
id: ADR-0001
title: การจัดการวงจรชีวิตของ Job, Session และการบันทึกสถานะด้วย SQLite (Job & Project Lifecycle Management)
status: Accepted
date: 2026-07-24
deciders:
  - Architecture Team
tags:
  - backend
  - persistence
  - state-machine
  - local-first
---

# ADR-0001: การจัดการวงจรชีวิตของ Job, Session และการบันทึกสถานะด้วย SQLite (Job & Project Lifecycle Management)

## Status

**Accepted** — ระบบนี้ได้รับการปรับปรุง schema เป็น Version 2 และใช้งานจริงในระบบปัจจุบัน

## Decision summary

เลือกใช้ **SQLite (Embedded Database)** ในการจัดเก็บข้อมูลสถานะของงาน (Jobs), โครงสร้างโปรเจกต์ (Projects), และขอบเขตพื้นที่ตัวอักษร (Regions) ภายในดิสก์ท้องถิ่น (`backend/uploads/state.sqlite3`) ร่วมกับ **FastAPI BackgroundTasks** และ **Server-Sent Events (SSE)** สำหรับการติดตามและประมวลผลงานแบบ Asynchronous โดยไม่ต้องพึ่งพา External Database Server หรือ Distributed Message Queue (เช่น PostgreSQL, Redis, RabbitMQ)

## Context

ระบบ AI Manga Translator (Jisa) ออกแบบมาสำหรับการใช้งานแบบ Local-first บนเครื่องเดี่ยว (Single-user Desktop Deployment) ผู้ใช้จะทำการอัปโหลดไฟล์ภาพการ์ตูนครั้งละหลายๆ หน้า (Batch Upload) และระบบจำเป็นต้องประมวลผล pipeline ผ่านหลายขั้นตอน: `queued` -> `segmenting` -> `ocr` -> `translating` -> `awaiting_review` (ถ้าเปิด Human-in-the-Loop) -> `inpainting` -> `typesetting` -> `completed`

ความท้าทายหลักคือ:
1. การประมวลผล AI/ML ต้องใช้ GPU VRAM อย่างมีประสิทธิภาพ และใช้เวลานานเกินกว่า HTTP Request/Response รอบเดียว
2. ต้องการความเรียบง่ายในการติดตั้ง (Zero-config setup) ไม่ต้องการให้ผู้ใช้ต้องรัน Docker DB/Redis เพิ่มเติม
3. ต้องรองรับการสลับลำดับหน้าการ์ตูน (`sequence_id`) และการลบข้อมูลแบบ Cascading สอดคล้องกับดิสก์

## Scope

### In scope
- โครงสร้าง SQLite Schema v2 (`jobs`, `projects`, `regions`, `pending_asset_deletions`) ใน `backend/repository.py`
- การจัดการ State Machine และ Background Worker Thread ใน `backend/main.py`
- การสื่อสารสถานะเรียลไทม์ผ่าน SSE Client Stream `/api/stream/events`

### Out of scope
- ระบบ Multi-tenant authentication และ User permission management
- Distributed Job Queue ข้ามหลายเครื่อง (Distributed Workers)

## Evidence

| Claim | Classification | Evidence |
|---|---|---|
| ฐานข้อมูลหลักใช้ SQLite3 ชนิดไฟล์เดี่ยว `uploads/state.sqlite3` | **Fact** | `backend/repository.py:65-72` |
| SQLite Schema เวอร์ชัน 2 รองรับ `projects`, `sequence_id`, และ `pending_asset_deletions` | **Fact** | `backend/repository.py:100-160` |
| งานแปลประมวลผลแบบ Asynchronous ผ่าน FastAPI BackgroundTasks | **Fact** | `backend/main.py:590-620` |
| ระบบมี State Machine ชัดเจนรวมถึงสถานะ `awaiting_review` สำหรับตรวจทาน | **Fact** | `backend/repository.py:30-45` |
| การสื่อสารสถานะแบบเรียลไทม์ใช้ SSE Broadcast (`EventManager`) | **Fact** | `backend/main.py:120-155` |

## Decision drivers

1. **Zero External Service Overhead**: ต้องการให้แอปพลิเคชันทำงานได้ทันทีโดยไม่ต้องเปิดบริการ Database/Message Broker ภายนอก
2. **Local Data Isolation & Reliability**: ข้อมูลโปรเจกต์ ภาพ และสถานะทั้งหมดต้องบันทึกอยู่ในเครื่องของผู้ใช้โดยสมบูรณ์
3. **Deterministic Page Ordering**: ลำดับภาพแปลในโปรเจกต์ต้องคงเดิมเสมอ แม้เปิดแอปพลิเคชันใหม่ (`jobs.sequence_id`)

## Constraints

- SQLite รองรับ Concurrent Writes จำกัด (Single-writer WAL mode) ซึ่งเหมาะสมกับการใช้งานแบบ Single-user
- การประมวลผลงานภาพความละเอียดสูงบน GPU ต้องทำตามลำดับเพื่อป้องกัน Out of Memory (OOM)

## Considered options

### Option 1: Embedded SQLite + FastAPI BackgroundTasks + SSE (เลือกตัวเลือกนี้)
- **ประโยชน์**: ไม่มี External Dependency, ตั้งค่าง่าย, ลบ/ย้ายโปรเจกต์ได้ง่ายเพียงจัดการไฟล์ SQLite และไฟล์ภาพบนดิสก์
- **ข้อเสีย**: ไม่รองรับการกระจาย Worker ไปยังหลายเครื่อง
- **ความเสี่ยง**: หากประมวลผลล้มเหลวขณะเขียน SQLite อาจเกิด Lock Timeout ได้ แต่หลีกเลี่ยงด้วยการตั้งค่า Connection Timeout และ WAL Mode

### Option 2: PostgreSQL + Celery + Redis
- **ประโยชน์**: รองรับการสเกลระดับ Enterprise และ Distributed Queue
- **ข้อเสีย**: เพิ่มความซับซ้อนอย่างมาก ผู้ใช้ต้องติดตั้ง Docker, Redis, PostgreSQL เพิ่มเติม ซึ่งขัดกับหลักการ Local-first

## Option comparison

| Criterion | Priority / Weight | Option 1 (SQLite) | Option 2 (Postgres/Redis) | Notes |
|---|---:|---:|---:|---|
| Ease of Local Setup | 5 | 5/5 | 1/5 | SQLite ไม่ต้องติดตั้งบริการเพิ่มเติม |
| Low Resource Footprint | 5 | 5/5 | 2/5 | SQLite ใช้ Memory ต่ำมาก |
| Multi-worker Scaling | 2 | 2/5 | 5/5 | Jisa เน้นรันเครื่องเดี่ยวเป็นหลัก |
| Data Persistence Reliability | 4 | 4/5 | 5/5 | SQLite Schema v2 มีการตรวจสอบ integrity |

## Decision

เลือก **Option 1 (Embedded SQLite + FastAPI BackgroundTasks + SSE)** เพื่อให้ระบบสอดคล้องกับสถาปัตยกรรม Local-first แอปพลิเคชันมีโครงสร้างเบา ติดตั้งง่าย และตอบสนองต่อการทำงานเดี่ยวบนเครื่องผู้ใช้ได้อย่างเต็มประสิทธิภาพ

## Consequences

### Positive
- ติดตั้งง่าย ไม่ต้องกังวลเรื่องการตั้งค่า Database credentials หรือ Redis Server
- ประสิทธิภาพในการอ่านเขียนข้อมูลสถานะงานและ Bounding boxes บนดิสก์ SSD มีความเร็วสูงมาก
- สามารถลบและทำความสะอาดไฟล์ขยะ (`pending_asset_deletions`) ได้โดยอัตโนมัติ

### Negative
- ไม่เหมาะกับการขยายระบบเป็น Cloud Multi-tenant SaaS ในอนาคตโดยไม่มีการ Refactor ระบบ persistence

### Risks accepted
- SQLite Lock ในกรณีที่มีการเขียนข้อมูลถี่สูงพร้อมกัน ซึ่งแก้ปัญหาด้วย WAL mode และ Connection timeout ใน `backend/repository.py`

## Implementation and migration strategy

1. ระบบสตรีมข้อมูลผ่าน SSE โดยมี `EventManager` กระจายอัปเดตสถานะไปยัง Frontend เมื่อ `jobs.status` เปลี่ยนแปลง
2. เมื่อมีการลบ Project หรือ Job ระบบจะบันทึกพาธไฟล์ที่ต้องลบลงในตาราง `pending_asset_deletions` เพื่อความปลอดภัยในการลบไฟล์จากดิสก์

## Validation

- **Automated Tests**: ทดสอบผ่าน `backend/tests/test_repository.py` และ `backend/tests/test_projects_workflow.py`
- **Success Signal**: สถานะงานเปลี่ยนผ่านสำเร็จครบวงจรตั้งแต่ `queued` ถึง `completed` โดยไม่เกิด DB Locked Error

## Review triggers

- เมื่อต้องการขยายระบบเป็น Multi-user Web Service หรือต้องการแยก GPU Worker Node ไปยังเครื่องอื่น

## References

- `docs/CODEBASE.md`
- `backend/repository.py`
- `backend/main.py`
