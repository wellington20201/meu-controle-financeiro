ALTER TABLE usuarios
ADD COLUMN IF NOT EXISTS mascote_id VARCHAR(30) DEFAULT 'bento';

UPDATE usuarios
SET mascote_id = 'bento'
WHERE mascote_id IS NULL OR mascote_id NOT IN ('bento','nico','luna','tito','pip');

ALTER TABLE usuarios
ALTER COLUMN mascote_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_mascote_id_check') THEN
    ALTER TABLE usuarios
    ADD CONSTRAINT usuarios_mascote_id_check
    CHECK (mascote_id IN ('bento','nico','luna','tito','pip'));
  END IF;
END $$;
