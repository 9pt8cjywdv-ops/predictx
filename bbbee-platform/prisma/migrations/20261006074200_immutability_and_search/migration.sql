-- Immutability guarantees enforced by the database, not just application code.

CREATE OR REPLACE FUNCTION bbbee_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

-- Audit log: append-only.
CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION bbbee_forbid_mutation();
CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION bbbee_forbid_mutation();

-- Verification snapshots: immutable once written.
CREATE TRIGGER snapshot_no_update BEFORE UPDATE ON "VerificationSnapshot"
  FOR EACH ROW EXECUTE FUNCTION bbbee_forbid_mutation();
CREATE TRIGGER snapshot_no_delete BEFORE DELETE ON "VerificationSnapshot"
  FOR EACH ROW EXECUTE FUNCTION bbbee_forbid_mutation();

-- Original document bytes: a version's hash/storage key can never change, and
-- versions cannot be deleted. Only scan status may move forward.
CREATE OR REPLACE FUNCTION bbbee_document_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DocumentVersion rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."sha256" <> OLD."sha256" OR NEW."storageKey" <> OLD."storageKey"
     OR NEW."sizeBytes" <> OLD."sizeBytes" OR NEW."originalFilename" <> OLD."originalFilename"
     OR NEW."documentId" <> OLD."documentId" OR NEW."versionNumber" <> OLD."versionNumber" THEN
    RAISE EXCEPTION 'DocumentVersion content fields are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_version_guard BEFORE UPDATE OR DELETE ON "DocumentVersion"
  FOR EACH ROW EXECUTE FUNCTION bbbee_document_version_guard();

-- Overrides are evidence of human decisions; they are append-only too.
CREATE TRIGGER override_no_update BEFORE UPDATE ON "Override"
  FOR EACH ROW EXECUTE FUNCTION bbbee_forbid_mutation();
CREATE TRIGGER override_no_delete BEFORE DELETE ON "Override"
  FOR EACH ROW EXECUTE FUNCTION bbbee_forbid_mutation();

-- Regulatory retrieval: PostgreSQL full-text search over provisions.
-- (pgvector embeddings are added in a later migration once the extension is provisioned.)
CREATE INDEX regulatory_provision_fts ON "RegulatoryProvision"
  USING GIN (to_tsvector('english', coalesce("heading", '') || ' ' || coalesce("text", '')));
