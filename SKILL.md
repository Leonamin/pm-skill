# PM Skill — 정형화된 프로젝트 관리 도구

Linear와 Notion을 정형화된 틀 안에서 조작하는 프로젝트 관리 스킬.
"설계의 자유, 사용의 부자유" — config.yml에 정의된 라벨/템플릿/severity만 사용 가능.

## 설정

### 1. API 키 발급

**Linear**: Settings > API > Personal API Keys
**Notion**: https://www.notion.so/my-integrations > New integration

### 2. .env 생성

```bash
cp .env.example .env
# LINEAR_API_KEY, NOTION_API_KEY 입력
```

### 3. Setup 실행

```bash
npx tsx src/workflows.ts setup
```

팀/상태/라벨 ID를 확인하고 `.env`에 `LINEAR_DEFAULT_TEAM_ID` 등을 설정.

### 4. Config 커스터마이징

`config.yml`에서 라벨, 템플릿, severity 매핑을 프로젝트에 맞게 수정.
**규칙: 모든 라벨/템플릿에 `description` 필수.** 없으면 로딩 시 에러.

```yaml
labels:
  - id: my-label
    name: My Label
    description: "이 라벨의 용도 설명"  # ← 필수!
```

## 커맨드 레퍼런스

### setup
Linear/Notion 연결 상태 확인 + .env 안내.
```bash
npx tsx src/workflows.ts setup
```

### start-feature
기능 개발 시작. Linear 이슈 + Notion PRD + 상호 URL 연결.
```bash
npx tsx src/workflows.ts start-feature "예약 취소 기능"
```

### report-bug
버그 리포트. severity로 우선순위 자동 매핑.
```bash
npx tsx src/workflows.ts report-bug "결제 금액 오류" --severity high
# severity: urgent, high, medium(기본), low
```

### add-task
이슈에 하위 태스크 추가.
```bash
npx tsx src/workflows.ts add-task ENG-10 "단위 테스트 작성"
```

### relate
이슈 간 관계 설정. (related, similar)
```bash
npx tsx src/workflows.ts relate ENG-10 ENG-11 --type related
```

### block
선행 관계 설정. (ENG-10 완료 후 ENG-11 진행)
```bash
npx tsx src/workflows.ts block ENG-10 ENG-11
```

### attach-doc
이슈에 문서 URL 첨부. doc_type은 config 검증.
```bash
npx tsx src/workflows.ts attach-doc ENG-10 \
  --url "https://notion.so/..." \
  --title "결제 설계서" \
  --type source-of-truth
# type: source-of-truth, issue-tracking, domain-knowledge
```

### get
이슈 상세 조회. 하위이슈, 관계, 첨부문서 포함.
```bash
npx tsx src/workflows.ts get ENG-10
```

## 워크플로우 예시

### 기능 개발
```bash
# 1. 기능 시작
npx tsx src/workflows.ts start-feature "예약 취소 기능"
# → Linear ENG-10 + Notion PRD 생성

# 2. 하위 태스크 추가
npx tsx src/workflows.ts add-task ENG-10 "API 엔드포인트 구현"
npx tsx src/workflows.ts add-task ENG-10 "프론트엔드 UI"
npx tsx src/workflows.ts add-task ENG-10 "테스트 작성"

# 3. 관련 이슈 연결
npx tsx src/workflows.ts relate ENG-10 ENG-8 --type related

# 4. 선행 관계 설정
npx tsx src/workflows.ts block ENG-10 ENG-15
```

### 버그 수정
```bash
# 1. 버그 리포트
npx tsx src/workflows.ts report-bug "결제 금액 오류" --severity high

# 2. 하위 태스크
npx tsx src/workflows.ts add-task ENG-20 "원인 분석"
npx tsx src/workflows.ts add-task ENG-20 "수정 및 테스트"
```

## Config 구조

| 섹션 | 설명 |
|------|------|
| `labels` | 사용 가능한 라벨 목록 (description 필수) |
| `templates` | 커맨드별 기본 라벨/우선순위/Notion 템플릿 매핑 |
| `priorities` | Plank 우선순위 → Linear 우선순위 매핑 (p0-p3) |
| `severity_mapping` | severity 이름 → priority 키 매핑 |
| `doc_types` | 문서 유형 (attach-doc의 --type 값) |
| `epics` | 에픽 목록 (프로젝트별 정의) |
