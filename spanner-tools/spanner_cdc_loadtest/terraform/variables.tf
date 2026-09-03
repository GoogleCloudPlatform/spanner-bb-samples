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

variable "project_id" {
  type        = string
  description = "The Google Cloud project ID where Spanner resources will be created."
}

variable "region" {
  type        = string
  default     = "us-central1"
  description = "The Google Cloud region for Spanner regional instance configuration."
}

variable "instance_config" {
  type        = string
  default     = "regional-us-central1"
  description = "The Spanner instance configuration (e.g., regional-us-central1, nam-eur-asia1)."
}

variable "instance_prefix" {
  type        = string
  default     = "spanner-loadtest"
  description = "Prefix for the Spanner instance name."
}

variable "processing_units" {
  type        = number
  default     = 1000
  description = "Compute capacity for each Spanner instance in Processing Units (PUs). Default: 1000 (1 Node). Can be set to 100 PUs for lightweight testing."
}

variable "database_id" {
  type        = string
  default     = "loadtest-db"
  description = "The Spanner database name created within each instance."
}

variable "deletion_protection" {
  type        = bool
  default     = false
  description = "Whether to prevent destruction of the Spanner database. Defaults to false for load test environments."
}

variable "change_streams" {
  type        = list(string)
  default     = ["OLD_AND_NEW_VALUES"]
  description = "List of change stream options to deploy instances for. Allowed values: NONE, OLD_AND_NEW_VALUES, NEW_VALUES, NEW_ROW, NEW_ROW_AND_OLD_VALUES."

  validation {
    condition = alltrue([
      for cs in var.change_streams : contains(
        ["NONE", "OLD_AND_NEW_VALUES", "NEW_VALUES", "NEW_ROW", "NEW_ROW_AND_OLD_VALUES"],
        cs
      )
    ])
    error_message = "Valid change stream options are: NONE, OLD_AND_NEW_VALUES, NEW_VALUES, NEW_ROW, NEW_ROW_AND_OLD_VALUES."
  }
}
