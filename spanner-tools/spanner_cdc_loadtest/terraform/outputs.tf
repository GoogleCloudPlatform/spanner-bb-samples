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

output "instances" {
  description = "Summary of provisioned Spanner instances, databases, change stream settings, and loadtest commands."
  value = {
    for cs in var.change_streams : cs => {
      instance_id   = google_spanner_instance.main[cs].name
      database_id   = google_spanner_database.main[cs].name
      change_stream = cs != "NONE" ? "LoadTestStream (value_capture_type = ${cs})" : "NONE (No change stream)"
      run_command   = "java -jar target/spanner-cdc-loadtest-1.0-SNAPSHOT.jar -p ${var.project_id} -i ${google_spanner_instance.main[cs].name} -d ${var.database_id}"
    }
  }
}
