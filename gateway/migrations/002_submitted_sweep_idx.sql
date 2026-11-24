-- 002_submitted_sweep_idx.sql: find messages that have waited too long for a DLR.
--
-- The sweep in gateway/sweeper.py expires messages that stayed SUBMITTED past
-- the carrier's validity period. Only messages waiting for a DLR are in this
-- index, so it stays as small as the number of SMS in flight at the carrier,
-- and the sweep reads the oldest ones first without touching finished rows.
CREATE INDEX messages_submitted_sweep_idx
    ON messages (submitted_at)
    WHERE status = 'SUBMITTED';
