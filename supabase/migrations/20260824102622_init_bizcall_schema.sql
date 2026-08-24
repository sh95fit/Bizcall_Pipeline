-- 1. 업무폰 관리 테이블
CREATE TABLE phones (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(100) NOT NULL,
    device_id     VARCHAR(255) UNIQUE NOT NULL,
    token         VARCHAR(255) UNIQUE NOT NULL,
    is_active     BOOLEAN DEFAULT TRUE,
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ
);

-- 2. 카테고리 마스터 테이블
CREATE TABLE categories (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id    UUID REFERENCES categories(id),
    name         VARCHAR(50) NOT NULL,
    description  TEXT,
    sort_order   INTEGER DEFAULT 0,
    is_active    BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (parent_id, name)
);

-- 3. VOC 원천 데이터 테이블
CREATE TABLE voc_records (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_id          UUID REFERENCES phones(id),
    phone_name        VARCHAR(100),
    caller_number     VARCHAR(50),
    call_direction    VARCHAR(10),
    call_started_at   TIMESTAMPTZ,
    call_ended_at     TIMESTAMPTZ,
    duration_sec      INTEGER,
    s3_key            TEXT NOT NULL,
    transcript        TEXT,
    summary           TEXT,
    category_id       UUID REFERENCES categories(id),
    sub_category_id   UUID REFERENCES categories(id),
    sentiment         VARCHAR(20),
    keywords          TEXT[],
    action_required   BOOLEAN DEFAULT FALSE,
    action_memo       TEXT,
    processing_status VARCHAR(20) DEFAULT 'pending',
    is_permanent      BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 인덱스
CREATE INDEX idx_voc_records_phone_id ON voc_records(phone_id);
CREATE INDEX idx_voc_records_category_id ON voc_records(category_id);
CREATE INDEX idx_voc_records_created_at ON voc_records(created_at);
CREATE INDEX idx_voc_records_processing_status ON voc_records(processing_status);
