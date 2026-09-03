#!/bin/bash
#
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

# Configuration with sensible defaults (can be overridden via environment variables)
JOB_NAME="${JOB_NAME:-spanner-loadtest}"
REGION="${REGION:-us-central1}"
NUM_EXECUTIONS="${NUM_EXECUTIONS:-8}"
TASKS_PER_EXECUTION="${TASKS_PER_EXECUTION:-10}"

TOTAL_TASKS=$((NUM_EXECUTIONS * TASKS_PER_EXECUTION))

echo "================================================================="
echo "Cloud Run Job:          ${JOB_NAME}"
echo "Region:                 ${REGION}"
echo "Number of Executions:   ${NUM_EXECUTIONS}"
echo "Tasks per Execution:    ${TASKS_PER_EXECUTION}"
echo "Total Concurrent Tasks: ${TOTAL_TASKS}"
echo "Note: Executions inherit default arguments configured during"
echo "      'gcloud run jobs create'."
echo "================================================================="

for ((i=1; i<=NUM_EXECUTIONS; i++))
do
   echo "Triggering job execution #${i} of ${NUM_EXECUTIONS} (${TASKS_PER_EXECUTION} tasks)..."
   gcloud run jobs execute "${JOB_NAME}" --region "${REGION}" --tasks "${TASKS_PER_EXECUTION}" &
done

# Wait for all background initiation processes to finish
wait

echo "All ${NUM_EXECUTIONS} job execution(s) triggered successfully."
