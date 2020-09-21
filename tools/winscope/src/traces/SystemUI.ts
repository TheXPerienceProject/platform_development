/*
 * Copyright 2020, The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { FILE_TYPES, TRACE_TYPES } from '@/decode.js';
import TraceBase from './TraceBase';

export default class SystemUI extends TraceBase {
  systemUIFile: any;

  constructor(files) {
    const systemUIFile = files[FILE_TYPES.SYSTEM_UI];
    super(systemUIFile.data, systemUIFile.timeline, files);

    this.systemUIFile = systemUIFile;
  }

  get type() {
    return TRACE_TYPES.SYSTEM_UI;
  }
}
