// Face-mesh landmark indices used by the geometric metrics (docs/architecture.md §10.1).
//
// These are the indices commonly used with MediaPipe's 468/478-point face mesh. They have NOT
// yet been verified visually: open the Vision Lab, enable "Metric points", and check that the
// labelled points sit on the eyelids, eye corners, inner lips and mouth corners
// (src/vision/README.md, "Manual checks").

/** Six eye points [p1, p2, p3, p4, p5, p6]: corners p1 and p4; upper lid p2, p3; lower lid p6, p5. */
export type EyeIndices = readonly [number, number, number, number, number, number];

/** The subject's right eye (on the left of the raw, unmirrored frame). */
export const RIGHT_EYE: EyeIndices = [33, 160, 158, 133, 153, 144];

/** The subject's left eye. */
export const LEFT_EYE: EyeIndices = [362, 385, 387, 263, 373, 380];

/** Inner-lip vertical pairs [upper, lower], averaged to reduce noise. */
export const MOUTH_VERTICAL_PAIRS: readonly (readonly [number, number])[] = [
  [82, 87],
  [13, 14],
  [312, 317],
];

/** Inner mouth corners [left of the raw frame, right of the raw frame]. */
export const MOUTH_CORNERS: readonly [number, number] = [78, 308];

/** Every index the geometric metrics read; drawn by the Vision Lab to verify them. */
export const METRIC_LANDMARK_INDICES: readonly number[] = [
  ...RIGHT_EYE,
  ...LEFT_EYE,
  ...MOUTH_VERTICAL_PAIRS.flat(),
  ...MOUTH_CORNERS,
];
