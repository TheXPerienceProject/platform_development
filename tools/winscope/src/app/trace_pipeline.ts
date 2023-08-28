/*
 * Copyright (C) 2022 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {ProgressListener} from 'interfaces/progress_listener';
import {ParserError, ParserErrorType, ParserFactory} from 'parsers/parser_factory';
import {ParserFactory as PerfettoParserFactory} from 'parsers/perfetto/parser_factory';
import {TracesParserFactory} from 'parsers/traces_parser_factory';
import {FrameMapper} from 'trace/frame_mapper';
import {Parser} from 'trace/parser';
import {TimestampType} from 'trace/timestamp';
import {Trace} from 'trace/trace';
import {Traces} from 'trace/traces';
import {TraceFile} from 'trace/trace_file';
import {TraceType} from 'trace/trace_type';
import {TraceFileFilter} from './trace_file_filter';

class TracePipeline {
  private traceFileFilter = new TraceFileFilter();
  private parserFactory = new ParserFactory();
  private tracesParserFactory = new TracesParserFactory();
  private parsers: Array<Parser<object>> = [];
  private files = new Map<TraceType, TraceFile>();
  private traces = new Traces();
  private commonTimestampType?: TimestampType;

  async loadTraceFiles(
    traceFiles: TraceFile[],
    progressListener?: ProgressListener
  ): Promise<ParserError[]> {
    const filterResult = await this.traceFileFilter.filter(traceFiles);
    if (!filterResult.perfetto && filterResult.legacy.length === 0) {
      return [new ParserError(ParserErrorType.NO_INPUT_FILES)];
    }

    const errors = filterResult.errors;

    if (filterResult.perfetto) {
      const perfettoParsers = await new PerfettoParserFactory().createParsers(
        filterResult.perfetto,
        progressListener
      );
      this.parsers = this.parsers.concat(perfettoParsers);
    }

    const [fileAndParsers, legacyErrors] = await this.parserFactory.createParsers(
      filterResult.legacy,
      progressListener
    );
    errors.push(...legacyErrors);
    for (const fileAndParser of fileAndParsers) {
      this.files.set(fileAndParser.parser.getTraceType(), fileAndParser.file);
    }

    const newParsers = fileAndParsers.map((it) => it.parser);
    this.parsers = this.parsers.concat(newParsers);

    const tracesParsers = await this.tracesParserFactory.createParsers(this.parsers);

    const allParsers = this.parsers.concat(tracesParsers);

    this.traces = new Traces();
    allParsers.forEach((parser) => {
      const trace = Trace.newUninitializedTrace(parser);
      this.traces?.setTrace(parser.getTraceType(), trace);
    });

    const hasTransitionTrace = this.traces
      .mapTrace((trace) => trace.type)
      .some((type) => type === TraceType.TRANSITION);
    if (hasTransitionTrace) {
      this.traces.deleteTrace(TraceType.WM_TRANSITION);
      this.traces.deleteTrace(TraceType.SHELL_TRANSITION);
    }

    return errors;
  }

  removeTrace(trace: Trace<object>) {
    this.parsers = this.parsers.filter((parser) => parser.getTraceType() !== trace.type);
    this.traces.deleteTrace(trace.type);
  }

  getLoadedFiles(): Map<TraceType, TraceFile> {
    return this.files;
  }

  async buildTraces() {
    const commonTimestampType = this.getCommonTimestampType();
    this.traces.forEachTrace((trace) => trace.init(commonTimestampType));
    await new FrameMapper(this.traces).computeMapping();
  }

  getTraces(): Traces {
    return this.traces;
  }

  async getScreenRecordingVideo(): Promise<undefined | Blob> {
    const screenRecording = this.getTraces().getTrace(TraceType.SCREEN_RECORDING);
    if (!screenRecording || screenRecording.lengthEntries === 0) {
      return undefined;
    }
    return (await screenRecording.getEntry(0).getValue()).videoData;
  }

  clear() {
    this.parserFactory = new ParserFactory();
    this.parsers = [];
    this.traces = new Traces();
    this.commonTimestampType = undefined;
    this.files = new Map<TraceType, TraceFile>();
  }

  private getCommonTimestampType(): TimestampType {
    if (this.commonTimestampType !== undefined) {
      return this.commonTimestampType;
    }

    const priorityOrder = [TimestampType.REAL, TimestampType.ELAPSED];
    for (const type of priorityOrder) {
      if (this.parsers.every((it) => it.getTimestamps(type) !== undefined)) {
        this.commonTimestampType = type;
        return this.commonTimestampType;
      }
    }

    throw Error('Failed to find common timestamp type across all traces');
  }
}

export {TracePipeline};
