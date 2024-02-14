/*
 * Copyright (C) 2024 The Android Open Source Project
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

import {assertDefined} from 'common/assert_utils';
import {AddOperation} from 'trace/tree_node/operations/add_operation';
import {PropertyTreeNode} from 'trace/tree_node/property_tree_node';
import {DEFAULT_PROPERTY_TREE_NODE_FACTORY} from 'trace/tree_node/property_tree_node_factory';

export class AddRootProperties extends AddOperation<PropertyTreeNode> {
  protected override makeProperties(value: PropertyTreeNode): PropertyTreeNode[] {
    const wmData = assertDefined(value.getChildByName('wmData'));
    const shellData = assertDefined(value.getChildByName('shellData'));
    const id = wmData.getChildByName('id') ?? shellData.getChildByName('id');

    const rootIdNode = DEFAULT_PROPERTY_TREE_NODE_FACTORY.makeCalculatedProperty(
      value.id,
      'id',
      assertDefined(id).getValue()
    );

    const realToElapsedTimeOffsetNs = value.getChildByName('aborted')
      ? wmData.getChildByName('realToElapsedTimeOffsetNs') ??
        shellData.getChildByName('realToElapsedTimeOffsetNs')
      : shellData.getChildByName('realToElapsedTimeOffsetNs') ??
        wmData.getChildByName('realToElapsedTimeOffsetNs');

    const realToElapsedTimeOffsetNsNode = DEFAULT_PROPERTY_TREE_NODE_FACTORY.makeCalculatedProperty(
      value.id,
      'realToElapsedTimeOffsetNs',
      assertDefined(realToElapsedTimeOffsetNs).getValue()
    );

    return [rootIdNode, realToElapsedTimeOffsetNsNode];
  }
}
