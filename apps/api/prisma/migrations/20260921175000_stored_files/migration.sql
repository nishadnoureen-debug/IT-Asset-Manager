-- File contents for STORAGE_DRIVER=database.
CREATE TABLE "stored_files" (
    "key" VARCHAR(512) NOT NULL,
    "content_type" VARCHAR(127) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "stored_files_size_check" CHECK ("size_bytes" = octet_length("data"))
);
