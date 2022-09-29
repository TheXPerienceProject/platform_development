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
import { Component, Input } from "@angular/core";
import { treeNodeDataViewStyles } from "viewers/components/styles/tree_node_data_view.styles";
import { Tree } from "viewers/common/tree_utils";
import Chip from "viewers/common/chip";

@Component({
  selector: "tree-node-data-view",
  template: `
    <span>
      <span class="kind">{{item.kind}}</span>
      <span *ngIf="item.kind && item.name">-</span>
      <span *ngIf="showShortName()" [matTooltip]="item.name">{{ item.shortName }}</span>
      <span *ngIf="!showShortName()">{{item.name}}</span>
      <div
        *ngFor="let chip of item.chips"
        [class]="chipClass(chip)"
        [matTooltip]="chip.long"
      >{{chip.short}}</div>
    </span>
  `,
  styles: [ treeNodeDataViewStyles ]
})

export class TreeNodeDataViewComponent {
  @Input() item!: Tree;

  showShortName() {
    return this.item.simplifyNames && this.item.shortName !== this.item.name;
  }

  chipClass(chip: Chip) {
    return [
      "tree-view-internal-chip",
      "tree-view-chip",
      "tree-view-chip" + "-" +
        (chip.type.toString() || "default"),
    ];
  }
}
