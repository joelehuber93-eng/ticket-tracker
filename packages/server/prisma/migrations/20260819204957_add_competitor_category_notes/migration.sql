-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CompetitorSite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "targetUrl" TEXT NOT NULL,
    "selector" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_CompetitorSite" ("createdAt", "id", "kind", "name", "selector", "targetUrl") SELECT "createdAt", "id", "kind", "name", "selector", "targetUrl" FROM "CompetitorSite";
DROP TABLE "CompetitorSite";
ALTER TABLE "new_CompetitorSite" RENAME TO "CompetitorSite";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
