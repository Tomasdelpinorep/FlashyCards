-- 0007: imported words can skip Learn and go straight to Train (docs/DECISIONS.md "Imports go to Train").
-- skip_learn = 1 on a never-studied (state 0) card puts it in the Train queue instead of Learn.
-- Set at import time when the deck's importToTrain setting is on; existing cards keep 0, so
-- existing decks behave as before. Additive: the deployed code ignores the column.
ALTER TABLE cards ADD COLUMN skip_learn INTEGER NOT NULL DEFAULT 0;
