import type { ShapeId } from '../state/types';

import plant01 from './plant01_big_leaf_dark.svg?raw';
import plant02 from './plant02_big_leaf_soft.svg?raw';
import plant03 from './plant03_big_spiky.svg?raw';
import plant04 from './plant04_med_spiky.svg?raw';
import plant05 from './plant05_tuft_dark.svg?raw';
import plant06 from './plant06_tuft_olive.svg?raw';
import plant07 from './plant07_round_shrub.svg?raw';
import plant08 from './plant08_round_shrub_small.svg?raw';
import plant09 from './plant09_leafy_gray.svg?raw';
import plant10 from './plant10_leafy_gray_alt.svg?raw';
import plant11 from './plant11_bright_radial.svg?raw';
import plant12 from './plant12_bright_radial_dense.svg?raw';
import plant13 from './plant13_lime_leafy.svg?raw';
import plant14 from './plant14_lime_leafy_alt.svg?raw';
import bushLeafy1 from './bush-leafy1.svg?raw';
import bushScratchy1 from './bush-scratchy1.svg?raw';
import bushScratchy2 from './bush-scratchy2.svg?raw';
import bushScratchy3 from './bush-scratchy3.svg?raw';
import grass1 from './grass1.svg?raw';
import plantLeaves1 from './plant-leaves1.svg?raw';
import plantLeaves2 from './plant-leaves2.svg?raw';
import bushFlowers1 from './bush-flowers1.svg?raw';
import bushFlowers2 from './bush-flowers2.svg?raw';
import bushFlowers3 from './bush-flowers3.svg?raw';
import bushLeafy2 from './bush-leafy2.svg?raw';
import flower1 from './flower1.svg?raw';
import flower2 from './flower2.svg?raw';
import rock1 from './rock1.svg?raw';
import rock2 from './rock2.svg?raw';
import rock3 from './rock3.svg?raw';
import rock4 from './rock4.svg?raw';
import rock5 from './rock5.svg?raw';

export const SHAPE_SVGS = {
  plant01_big_leaf_dark: plant01,
  plant02_big_leaf_soft: plant02,
  plant03_big_spiky: plant03,
  plant04_med_spiky: plant04,
  plant05_tuft_dark: plant05,
  plant06_tuft_olive: plant06,
  plant07_round_shrub: plant07,
  plant08_round_shrub_small: plant08,
  plant09_leafy_gray: plant09,
  plant10_leafy_gray_alt: plant10,
  plant11_bright_radial: plant11,
  plant12_bright_radial_dense: plant12,
  plant13_lime_leafy: plant13,
  plant14_lime_leafy_alt: plant14,
  'bush-leafy1': bushLeafy1,
  'bush-scratchy1': bushScratchy1,
  'bush-scratchy2': bushScratchy2,
  'bush-scratchy3': bushScratchy3,
  'bush-flowers1': bushFlowers1,
  'bush-flowers2': bushFlowers2,
  'bush-flowers3': bushFlowers3,
  'bush-leafy2': bushLeafy2,
  flower1,
  flower2,
  rock1,
  rock2,
  rock3,
  rock4,
  rock5,
  grass1,
  'plant-leaves1': plantLeaves1,
  'plant-leaves2': plantLeaves2,
} satisfies Record<ShapeId, string>;
