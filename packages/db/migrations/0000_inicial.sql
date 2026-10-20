CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"appmax_subscription_id" bigint,
	"request" jsonb,
	"response" jsonb,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"appmax_order_id" bigint NOT NULL,
	"status" text NOT NULL,
	"sub_total_cents" integer NOT NULL,
	"shipping_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	"installment_fee_cents" integer NOT NULL,
	"total_paid_cents" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"environment" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_encrypted" text NOT NULL,
	"last_backfill_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"cycle" integer NOT NULL,
	"appmax_order_id" bigint NOT NULL,
	"shopify_order_id" text,
	"charged_at" timestamp with time zone,
	"value_cents" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"appmax_id" bigint NOT NULL,
	"status" text NOT NULL,
	"interval" text,
	"interval_count" integer,
	"value_cents" integer NOT NULL,
	"freight_cents" integer,
	"current_cycle" integer,
	"completed_cycles" integer,
	"max_cycles" integer,
	"next_charge_at" timestamp with time zone,
	"last_charge_at" timestamp with time zone,
	"customer_name" text,
	"customer_email" text,
	"customer_document" text,
	"customer_phone" text,
	"card_brand" text,
	"card_last4" text,
	"products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"has_products" boolean NOT NULL,
	"origin_order_id" bigint,
	"appmax_created_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"paused_from" timestamp with time zone,
	"paused_until" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"event" text NOT NULL,
	"event_type" text,
	"appmax_subscription_id" bigint,
	"appmax_order_id" bigint,
	"dedupe_key" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD CONSTRAINT "subscription_charges_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD CONSTRAINT "subscription_charges_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_subscription_idx" ON "audit_logs" USING btree ("store_id","appmax_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_store_order_uq" ON "orders" USING btree ("store_id","appmax_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_charges_store_order_uq" ON "subscription_charges" USING btree ("store_id","appmax_order_id");--> statement-breakpoint
CREATE INDEX "subscription_charges_subscription_idx" ON "subscription_charges" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_store_appmax_uq" ON "subscriptions" USING btree ("store_id","appmax_id");--> statement-breakpoint
CREATE INDEX "subscriptions_store_status_idx" ON "subscriptions" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_store_email_idx" ON "subscriptions" USING btree ("store_id","customer_email");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_dedupe_uq" ON "webhook_events" USING btree ("store_id","dedupe_key") WHERE "webhook_events"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "webhook_events_subscription_idx" ON "webhook_events" USING btree ("store_id","appmax_subscription_id");