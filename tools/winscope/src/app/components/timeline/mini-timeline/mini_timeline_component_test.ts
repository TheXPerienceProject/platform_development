/*
 * Copyright (C) 2023 The Android Open Source Project
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

import {DragDropModule} from '@angular/cdk/drag-drop';
import {ChangeDetectionStrategy} from '@angular/core';
import {ComponentFixture, fakeAsync, TestBed} from '@angular/core/testing';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatIconModule} from '@angular/material/icon';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {MatTooltipModule} from '@angular/material/tooltip';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {TimelineData} from 'app/timeline_data';
import {assertDefined} from 'common/assert_utils';
import {TracesBuilder} from 'test/unit/traces_builder';
import {dragElement} from 'test/utils';
import {RealTimestamp} from 'trace/timestamp';
import {TraceType} from 'trace/trace_type';
import {MiniTimelineComponent} from './mini_timeline_component';
import {SliderComponent} from './slider_component';

describe('MiniTimelineComponent', () => {
  let fixture: ComponentFixture<MiniTimelineComponent>;
  let component: MiniTimelineComponent;
  let htmlElement: HTMLElement;
  let timelineData: TimelineData;
  const timestamp10 = new RealTimestamp(10n);
  const timestamp20 = new RealTimestamp(20n);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        FormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatIconModule,
        MatSelectModule,
        MatTooltipModule,
        ReactiveFormsModule,
        BrowserAnimationsModule,
        DragDropModule,
      ],
      declarations: [MiniTimelineComponent, SliderComponent],
    })
      .overrideComponent(MiniTimelineComponent, {
        set: {changeDetection: ChangeDetectionStrategy.Default},
      })
      .compileComponents();
    fixture = TestBed.createComponent(MiniTimelineComponent);
    component = fixture.componentInstance;
    htmlElement = fixture.nativeElement;

    timelineData = new TimelineData();
    const traces = new TracesBuilder()
      .setTimestamps(TraceType.SURFACE_FLINGER, [timestamp10])
      .setTimestamps(TraceType.WINDOW_MANAGER, [timestamp20])
      .build();
    timelineData.initialize(traces, undefined);
    component.timelineData = timelineData;
    expect(timelineData.getCurrentPosition()).toBeTruthy();
    component.currentTracePosition = timelineData.getCurrentPosition()!;
    component.selectedTraces = [TraceType.SURFACE_FLINGER];

    fixture.detectChanges();
  });

  it('can be created', () => {
    expect(component).toBeTruthy();
  });

  it('redraws on resize', () => {
    const spy = spyOn(assertDefined(component.drawer), 'draw');
    expect(spy).not.toHaveBeenCalled();

    component.onResize({} as Event);

    expect(spy).toHaveBeenCalled();
  });

  it('resets zoom on reset zoom button click', () => {
    const expectedZoomRange = {
      from: new RealTimestamp(15n),
      to: new RealTimestamp(16n),
    };
    timelineData.setZoom(expectedZoomRange);

    let zoomRange = timelineData.getZoomRange();
    let fullRange = timelineData.getFullTimeRange();
    expect(zoomRange).toBe(expectedZoomRange);
    expect(fullRange.from).toBe(timestamp10);
    expect(fullRange.to).toBe(timestamp20);

    fixture.detectChanges();

    const zoomButton = htmlElement.querySelector('button#reset-zoom-btn') as HTMLButtonElement;
    expect(zoomButton).toBeTruthy();
    assertDefined(zoomButton).click();

    zoomRange = timelineData.getZoomRange();
    fullRange = timelineData.getFullTimeRange();
    expect(zoomRange).toBe(fullRange);
  });

  it('show zoom controls when zoomed out', () => {
    const zoomControlDiv = htmlElement.querySelector('.zoom-control');
    expect(zoomControlDiv).toBeTruthy();
    expect(window.getComputedStyle(assertDefined(zoomControlDiv)).visibility).toBe('visible');

    const zoomButton = htmlElement.querySelector('button#reset-zoom-btn') as HTMLButtonElement;
    expect(zoomButton).toBeTruthy();
    expect(window.getComputedStyle(assertDefined(zoomButton)).visibility).toBe('visible');
  });

  it('shows zoom controls when zoomed in', () => {
    const zoom = {
      from: new RealTimestamp(15n),
      to: new RealTimestamp(16n),
    };
    timelineData.setZoom(zoom);

    fixture.detectChanges();

    const zoomControlDiv = htmlElement.querySelector('.zoom-control');
    expect(zoomControlDiv).toBeTruthy();
    expect(window.getComputedStyle(assertDefined(zoomControlDiv)).visibility).toBe('visible');

    const zoomButton = htmlElement.querySelector('button#reset-zoom-btn') as HTMLButtonElement;
    expect(zoomButton).toBeTruthy();
    expect(window.getComputedStyle(assertDefined(zoomButton)).visibility).toBe('visible');
  });

  it('loads zoomed out', () => {
    expect(component.isZoomed()).toBeFalse();
  });

  it('updates timelinedata on zoom changed', () => {
    const zoom = {
      from: new RealTimestamp(15n),
      to: new RealTimestamp(16n),
    };
    component.onZoomChanged(zoom);
    expect(timelineData.getZoomRange()).toBe(zoom);
  });

  it('creates an appropriately sized canvas', () => {
    expect(component.canvas.width).toBeGreaterThan(100);
    expect(component.canvas.height).toBeGreaterThan(10);
  });

  it('getTracesToShow returns traces targeted by selectedTraces', () => {
    const traces = component.getTracesToShow();
    const types: TraceType[] = [];
    traces.forEachTrace((trace) => {
      types.push(trace.type);
    });
    expect(types).toHaveSize(component.selectedTraces.length);
    for (const type of component.selectedTraces) {
      expect(types).toContain(type);
    }
  });

  it('moving slider around updates zoom', fakeAsync(async () => {
    const initialZoom = {
      from: new RealTimestamp(15n),
      to: new RealTimestamp(16n),
    };
    component.onZoomChanged(initialZoom);

    fixture.detectChanges();

    const slider = htmlElement.querySelector('.slider .handle');
    expect(slider).toBeTruthy();
    expect(window.getComputedStyle(assertDefined(slider)).visibility).toBe('visible');

    dragElement(fixture, assertDefined(slider), 100, 8);

    const finalZoom = timelineData.getZoomRange();
    expect(finalZoom).not.toBe(initialZoom);
  }));
});
