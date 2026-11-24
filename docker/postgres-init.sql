-- Runs once, when the PostgreSQL volume is first created.
-- A second database for the automated tests, which wipe it between tests.
CREATE DATABASE smsgw_test;
