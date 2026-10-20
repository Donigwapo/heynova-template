-- Phase 2B.2 dependency fix: ensure pgcrypto digest() is available
-- Additive, non-destructive.

create extension if not exists pgcrypto;
