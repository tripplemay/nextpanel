-- AlterTable: add lockout fields to User
ALTER TABLE "User" ADD COLUMN "loginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- CreateTable: token revocation list
CREATE TABLE "RevokedToken" (
    "jti"       TEXT         NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RevokedToken_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex: for efficient cleanup of expired tokens
CREATE INDEX "RevokedToken_expiresAt_idx" ON "RevokedToken"("expiresAt");
