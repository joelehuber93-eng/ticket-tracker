-- AlterTable
ALTER TABLE "Product" ADD COLUMN "checkoutUrl" TEXT;

-- CreateTable
CREATE TABLE "CheckoutQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "siteName" TEXT NOT NULL DEFAULT 'iBranson',
    "quantity" INTEGER NOT NULL,
    "subtotal" REAL,
    "taxesFees" REAL,
    "total" REAL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    CONSTRAINT "CheckoutQuote_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CheckoutQuote_productId_siteName_quantity_fetchedAt_idx" ON "CheckoutQuote"("productId", "siteName", "quantity", "fetchedAt");
