# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  table_ddl = <<-EOT
    CREATE TABLE LoadTestTable (
        Id STRING(36) NOT NULL,
        Data STRING(MAX),
        Counter INT64,
        IsActive BOOL,
        ExampleTimestamp TIMESTAMP OPTIONS (allow_commit_timestamp=true)
    ) PRIMARY KEY (Id)
  EOT

  # Concise suffixes to keep both instance ID and display name under Spanner's 30-character limit
  cs_suffixes = {
    "NONE"                   = "none"
    "OLD_AND_NEW_VALUES"     = "old-and-new"
    "NEW_VALUES"             = "new-values"
    "NEW_ROW"                = "new-row"
    "NEW_ROW_AND_OLD_VALUES" = "new-row-old"
  }

  instance_names = {
    for cs in var.change_streams : cs => substr(
      "${var.instance_prefix}-${lookup(local.cs_suffixes, cs, lower(replace(cs, "_", "-")))}",
      0,
      30
    )
  }
}

resource "google_spanner_instance" "main" {
  for_each         = toset(var.change_streams)
  name             = local.instance_names[each.value]
  display_name     = local.instance_names[each.value]
  config           = var.instance_config
  processing_units = var.processing_units
}

resource "google_spanner_database" "main" {
  for_each = toset(var.change_streams)
  instance = google_spanner_instance.main[each.value].name
  name     = var.database_id
  ddl = concat(
    [local.table_ddl],
    each.value != "NONE" ? [
      "CREATE CHANGE STREAM LoadTestStream FOR LoadTestTable OPTIONS (value_capture_type = '${each.value}', retention_period = '1d')"
    ] : []
  )
  deletion_protection = var.deletion_protection
  # Automated backups explicitly disabled (no backup schedules attached)
}
