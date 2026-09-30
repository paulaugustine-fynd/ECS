ALTER TABLE "Inventory" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "MockInventory" ("system" TEXT NOT NULL, "inventoryId" TEXT NOT NULL, "revision" INTEGER NOT NULL, "sellable" INTEGER NOT NULL, CONSTRAINT "MockInventory_pkey" PRIMARY KEY ("system", "inventoryId"));
