-- Migration number: 0004 	 2026-11-03T13:40:30.722Z
-- what the painting is made of, from capture, e.g. "Leinwand", "Öl auf Leinwand"
ALTER TABLE paintings ADD COLUMN material TEXT;
