/*
  Warnings:

  - You are about to drop the column `siteName` on the `CheckoutQuote` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CompetitorSite" ADD COLUMN "checkoutSelector" TEXT;

-- AlterTable
ALTER TABLE "ProductSite" ADD COLUMN "checkoutUrl" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CheckoutQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "competitorSiteId" TEXT,
    "quantity" INTEGER NOT NULL,
    "subtotal" REAL,
    "taxesFees" REAL,
    "total" REAL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    CONSTRAINT "CheckoutQuote_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CheckoutQuote_competitorSiteId_fkey" FOREIGN KEY ("competitorSiteId") REFERENCES "CompetitorSite" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CheckoutQuote" ("currency", "error", "fetchedAt", "id", "ok", "productId", "quantity", "subtotal", "taxesFees", "total") SELECT "currency", "error", "fetchedAt", "id", "ok", "productId", "quantity", "subtotal", "taxesFees", "total" FROM "CheckoutQuote";
DROP TABLE "CheckoutQuote";
ALTER TABLE "new_CheckoutQuote" RENAME TO "CheckoutQuote";
CREATE INDEX "CheckoutQuote_productId_competitorSiteId_quantity_fetchedAt_idx" ON "CheckoutQuote"("productId", "competitorSiteId", "quantity", "fetchedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
