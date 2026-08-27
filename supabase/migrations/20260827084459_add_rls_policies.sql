-- phones 테이블 RLS
ALTER TABLE phones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can read phones"
  ON phones FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated users can insert phones"
  ON phones FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated users can update phones"
  ON phones FOR UPDATE
  TO authenticated
  USING (true);

-- voc_records 테이블 RLS
ALTER TABLE voc_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can read voc_records"
  ON voc_records FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated users can update voc_records"
  ON voc_records FOR UPDATE
  TO authenticated
  USING (true);

-- categories 테이블 RLS
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can read categories"
  ON categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated users can insert categories"
  ON categories FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated users can update categories"
  ON categories FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "authenticated users can delete categories"
  ON categories FOR DELETE
  TO authenticated
  USING (true);

-- prompt_templates 테이블 RLS
ALTER TABLE prompt_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can read prompt_templates"
  ON prompt_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated users can update prompt_templates"
  ON prompt_templates FOR UPDATE
  TO authenticated
  USING (true);
