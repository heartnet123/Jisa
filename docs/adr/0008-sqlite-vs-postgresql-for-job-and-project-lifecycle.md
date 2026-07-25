---
id: ADR-0008
title: การเปรียบเทียบและการตัดสินใจเลือกระหว่าง SQLite กับ PostgreSQL สำหรับการจัดการ Job & Project Lifecycle Management
status: Accepted
date: 2026-07-24
deciders:
  - Architecture Team
tags:
  - backend
  - persistence
  - sqlite
  - postgresql
  - trade-off-analysis
---

# ADR-0008: การเปรียบเทียบและการตัดสินใจเลือกระหว่าง SQLite กับ PostgreSQL สำหรับการจัดการ Job & Project Lifecycle Management

## Status

**Accepted** — ยืนยันการเลือกใช้ **SQLite (WAL Mode)** สำหรับสภาพแวดล้อมระบบปัจจุบัน โดยมีกรอบเงื่อนไขที่ชัดเจนในการย้ายไปใช้ **PostgreSQL** ในอนาคต

## Decision summary

เลือกใช้ **SQLite (Embedded Database)** ในโหมด **WAL (Write-Ahead Logging)** ร่วมกับ `busy_timeout=5000` สำหรับจัดเก็บข้อมูลสถานะของ Job, Project Session, และ Bounding Box Regions ภายในเครื่องผู้ใช้ (Local Desktop Deployment) แทนการใช้ **PostgreSQL** เนื่องจากข้อได้เปรียบด้าน Zero-configuration, การทำความสะอาดดิสก์ควบคู่กับไฟล์ภาพ (Asset Lifecycle Isolation), และการใช้งานทรัพยากรต่ำ โดยกำหนดให้ PostgreSQL เป็นทางเลือกในการย้ายระบบ (Migration Path) เมื่อต้องการสเกลเป็น Cloud Multi-tenant SaaS

## Context

โมดูล **Job & Project Lifecycle Management** ทำหน้าที่เป็นศูนย์กลางบริหารจัดการสถานะงานแปลมังงะ จัดลำดับหน้าเพจ (`sequence_id`) และบันทึกตำแหน่ง Bounding Box บนหน้าเว็บ สภาพแวดล้อมของแอปพลิเคชัน Jisa ในปัจจุบันเป็นแบบ **Local-first Desktop Application** ที่เน้นการรันบนคอมพิวเตอร์ของผู้ใช้เดี่ยว (Single-user Local Host)

ทีมพัฒนาต้องประเมินและเปรียบเทียบทางเลือกระหว่าง:
1. **SQLite**: Embedded File-based Database ที่ติดมากับ Python Standard Library
2. **PostgreSQL**: Relational Database Management System (RDBMS) ระดับ Enterprise ที่มีฟีเจอร์สูงและรองรับ Concurrency สูง

## Scope

### In scope
- การเปรียบเทียบคุณสมบัติเชิงลึกระหว่าง SQLite และ PostgreSQL ในมิติต่างๆ (Architecture, Concurrency, Setup Complexity, Resource Usage, Operational Overhead)
- โครงสร้าง persistence layer ใน `backend/repository.py`
- เงื่อนไขและสัญญาณสะท้อน (Review Triggers) ที่ต้องสลับไปใช้ PostgreSQL

### Out of scope
- การเปรียบเทียบกับ NoSQL Databases (เช่น MongoDB, Redis Document Store)

## Evidence

| Claim | Classification | Evidence |
|---|---|---|
| ระบบปัจจุบันใช้ SQLite3 ผ่านไฟล์ `uploads/state.sqlite3` | **Fact** | `backend/repository.py:65-72` |
| SQLite ถูกตั้งค่าเปิด WAL Mode และ `busy_timeout=5000` | **Fact** | `backend/repository.py:75-95` |
| แอปพลิเคชันถูกออกแบบเป็น Single-user Local Deployment | **Constraint** | `docs/CODEBASE.md:46-49` |
| PostgreSQL ต้องเปิดบริการ Background Service (Port 5432) และจัดการ Credentials | **Fact** | พฤติกรรมมาตรฐานของ PostgreSQL RDBMS |
| ลำดับหน้าเพจในโปรเจกต์อ้างอิงจาก `jobs.sequence_id` ในตาราง Relational | **Fact** | `backend/repository.py:120-140` |

## Decision drivers

1. **Zero External Dependency (การติดตั้งง่ายที่สุด)**: ผู้ใช้ต้องสามารถเปิดใช้งานโปรแกรมได้ทันทีโดยไม่ต้องรัน Docker หรือติดตั้ง Database Server เพิ่มเติม
2. **Local Data & File Alignment**: ไฟล์ฐานข้อมูลอยู่แฟ้มเดียวกับไฟล์ภาพ (`uploads/`) ลบหรือย้ายโปรเจกต์ได้ง่ายโดยไม่ต้องจัดการกับ DB Service ภายนอก
3. **Low Resource Footprint**: ไม่สิ้นเปลือง RAM และ CPU สำหรับการรัน Database Connection Pool หรือ Background Daemon

## Constraints

- SQLite รองรับ Concurrent Writer เพียง 1 Process ในเวลาเดียวกัน (แม้ใน WAL mode จะอ่านพร้อมกันได้หลาย Connection)
- PostgreSQL ให้ประสิทธิภาพสูงกว่าในการจัดการข้อมูลมหาศาลและการทำ Concurrent Writes จากผู้ใช้หลายคนพร้อมกัน

## Considered options

### Option 1: SQLite (Embedded File-based) ในโหมด WAL (เลือกตัวเลือกปัจจุบัน)
- **สถาปัตยกรรม**: ข้อมูลบันทึกในไฟล์เดี่ยว `uploads/state.sqlite3` ภายในโปรเจกต์
- **จุดเด่น**: 
  - Zero-config 100% ไม่ต้องติดตั้งโปรแกรมอื่นเพิ่มเติม
  - ประสิทธิภาพในการอ่าน (Read Throughput) บน SSD สูงมากเทียบเท่า Memory Access
  - ลบหรือสำรองข้อมูลได้ง่ายโดยการคัดลอก/ลบไฟล์ดิสก์
  - ใช้ RAM ต่ำมาก (< 10MB)
- **จุดด้อย**:
  - ไม่รองรับการเขียนข้อมูลพร้อมกันจากหลายเครื่องผ่าน Network File System
  - ไม่รองรับฟีเจอร์ JSON Query ระดับสูงหรือ Pub/Sub ภายใน DB

### Option 2: PostgreSQL (Client-Server RDBMS)
- **สถาปัตยกรรม**: รันเป็น Daemon Process / Docker Container สื่อสารผ่าน TCP/IP (Port 5432)
- **จุดเด่น**:
  - รองรับ Concurrent Writes และ Multi-user Access ได้ไม่จำกัด
  - มีระบบ Connection Pooling, Fine-grained Locking (Row-level Lock) และ JSONB Query
  - รองรับการแยก Database Server ไปอยู่นอกเครื่อง (Remote DB Cluster)
- **จุดด้อย**:
  - เพิ่มความซับซ้อนในการติดตั้ง ผู้ใช้ทั่วไปต้องติดตั้ง PostgreSQL หรือรัน Docker Compose
  - ใช้ทรัพยากรเครื่องเพิ่มขึ้น (RAM อย่างน้อย 100MB - 500MB+ สำหรับ DB Service)
  - ต้องดูแลจัดการ Database Connection, User Passwords, Port Conflict และ Database Migrations

## Detailed Comparison Matrix (ตารางเปรียบเทียบเชิงลึก)

| มิติการประเมิน (Evaluation Dimension) | ความสำคัญ (Weight) | SQLite (Option 1) | PostgreSQL (Option 2) | วิเคราะห์ผลกระทบต่อ Jisa |
|---|---:|---:|---:|---|
| **Ease of Deployment & Setup** | 5 | **5/5** | **1/5** | SQLite ติดตั้งพร้อมใช้ทันที PostgreSQL ต้องใช้ Docker/Setup |
| **Resource Consumption (RAM/CPU)** | 5 | **5/5** | **2/5** | SQLite กินทรัพยากรน้อย ช่วยเว้น RAM/GPU ให้ AI Models |
| **Concurrency & Write Throughput** | 3 | **3/5** | **5/5** | Jisa รันงานแบบ Sequential Batch ต่อเครื่อง SQLite WAL เพียงพอ |
| **Backup & Asset Portability** | 4 | **5/5** | **3/5** | SQLite ย้าย/ลบแฟ้ม `uploads/` ได้แบบ Atomic |
| **Multi-tenant Cloud Readiness** | 2 | **1/5** | **5/5** | PostgreSQL เหมาะสำหรับการทำ Web Cloud SaaS ในอนาคต |
| **Maintenance Overhead** | 4 | **5/5** | **2/5** | SQLite ไม่มีความเสี่ยงเรื่อง Port conflict หรือ DB crash |

## Decision

**ยืนยันการเลือก Option 1 (SQLite ในโหมด WAL) สำหรับสถาปัตยกรรมปัจจุบัน**

### เหตุผลทางสถาปัตยกรรม:
1. **สอดคล้องกับเป้าหมาย Local-First**: Jisa เป็นซอฟต์แวร์ประมวลผลบนเครื่องส่วนบุคคล การบังคับให้ผู้ใช้ติดตั้ง PostgreSQL จะเพิ่มอุปสรรคในการใช้งาน (Onboarding Friction) อย่างมาก
2. **ไม่เป็น Bottleneck ต่อประสิทธิภาพ**: การประมวลผลมังงะเป็นแบบคิวตามลำดับ (Sequential Pipeline บน GPU) จำนวนการเขียนฐานข้อมูลไม่ได้สูงในระดับพันครั้งต่อวินาที WAL Mode ของ SQLite จึงทำงานได้เหลือแหล่
3. **ประหยัดทรัพยากรเครื่อง**: ปล่อย RAM และ GPU VRAM ทั้งหมดให้โมเดล YOLO, SAM 2, LaMa และ Ollama ประมวลผลได้อย่างเต็มที่

## Trade-offs & Accepted Risks (ข้อดีข้อเสียและความเสี่ยงที่ยอมรับ)

### สิ่งที่ยอมรับ (Accepted Risks):
- **Single-writer Limitation**: หากเปิดใช้งานแอปพลิเคชันพร้อมกันหลายหน้าต่างและมีการสั่งประมวลผลถี่สูง อาจเกิด Lock Wait ซึ่งถูกแก้ไขด้วยการตั้งค่า `PRAGMA busy_timeout=5000` และเปิด WAL mode ใน `backend/repository.py`
- **ไม่รองรับ Distributed Workers**: ไม่สามารถแยก Worker Node ไปประมวลผลบนเครื่องอื่นในเครือข่ายได้โดยตรง

## Implementation & Migration Path (แนวทางการย้ายไป PostgreSQL ในอนาคต)

หากต้องการสลับไปใช้ **PostgreSQL** ในอนาคตเมื่อเปลี่ยนเป็น Cloud SaaS สามารถทำได้ราบรื่นเนื่องจากระบบมี Abstraction Layer อยู่แล้ว:

1. **Repository Pattern Isolation**: โค้ดส่วนใหญ่สื่อสารผ่านคลาส `SQLiteReviewRepository` ใน [backend/repository.py](file:///e:/webappgithub/Jisa/backend/repository.py)
2. **ขั้นตอนการ Refactor หากย้ายไป PostgreSQL**:
   - สร้าง `PostgresReviewRepository` ที่ implement Interface เดียวกัน
   - นำ SQLAlchemy หรือ SQLModel มาใช้ในการจัดการ Connection Pool และ Async Driver (`asyncpg`)
   - นำ Alembic มาใช้จัดการ Database Schema Migration

## Validation (การทดสอบยืนยัน)

- **Automated Tests**: ทดสอบความถูกต้องของ SQLite Repository ผ่าน `backend/tests/test_repository.py` และ `backend/tests/test_projects_workflow.py`
- **Concurrency Test**: ทดสอบผ่าน Concurrent Write Stress Tests โดยไม่เกิด `sqlite3.OperationalError: database is locked`

## Review Triggers (เงื่อนไขที่ต้องทบทวนเพื่อเปลี่ยนไปใช้ PostgreSQL)

ทบทวนการเลือกใช้ SQLite และพิจารณาย้ายไป PostgreSQL ทันทีเมื่อเกิดเงื่อนไขดังต่อไปนี้:
1. **เปลี่ยนเป้าหมายเป็น Multi-Tenant Cloud SaaS**: เมื่อปรับเปลี่ยนจากการใช้งานในเครื่องเดี่ยวไปเป็นบริการเว็บที่มีผู้ใช้ล็อกอินพร้อมกันหลายร้อยคน
2. **ต้องการทำ Distributed GPU Processing**: เมื่อต้องแยก Worker ไปรันบน GPU Server หลายเครื่องโดยแชร์ Database กลางร่วมกัน
3. **เกิดปัญหา Database Lock Rate สูงเกิน 1%** ของจำนวน HTTP Request ทั้งหมด

## References

- `docs/CODEBASE.md`
- [docs/adr/0001-job-lifecycle-and-sqlite-persistence.md](file:///e:/webappgithub/Jisa/docs/adr/0001-job-lifecycle-and-sqlite-persistence.md)
- [backend/repository.py](file:///e:/webappgithub/Jisa/backend/repository.py)
- `backend/tests/test_repository.py`
