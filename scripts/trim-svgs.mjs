import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as cheerio from 'cheerio';

const resolveResourcesDir = () => {
  const input = process.argv[2];
  if (!input) {
    return path.join(process.cwd(), 'src', 'resources');
  }

  return path.isAbsolute(input) ? input : path.join(process.cwd(), input);
};

const resourcesDir = resolveResourcesDir();
const DECIMAL_PLACES = 3;
const MIN_PADDING = 2;
const PADDING_RATIO = 0.05;
const EPSILON = 1e-6;

const isRenderableTag = (tag) =>
  [
    'path',
    'circle',
    'ellipse',
    'rect',
    'line',
    'polyline',
    'polygon',
    'use',
    'image',
  ].includes(tag);

const isContainerTag = (tag) => ['svg', 'g', 'symbol'].includes(tag);

const formatNumber = (value) => {
  const rounded = Number(value.toFixed(DECIMAL_PLACES));
  if (Object.is(rounded, -0)) {
    return '0';
  }
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

const parseNumber = (value, fallback = 0) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseLength = (value, fallback = 0) => parseNumber(value, fallback);

const parseStyle = (styleString) => {
  if (!styleString) {
    return {};
  }
  return styleString
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const [key, ...rest] = entry.split(':');
      if (!key || rest.length === 0) {
        return acc;
      }
      acc[key.trim()] = rest.join(':').trim();
      return acc;
    }, {});
};

const getAttribute = (node, name) => node.attr(name);

const getStyleValue = (node, name) => {
  const style = parseStyle(node.attr('style'));
  return style[name];
};

const getStrokeWidth = (node) => {
  const stroke = getAttribute(node, 'stroke') ?? getStyleValue(node, 'stroke');
  if (!stroke || stroke === 'none') {
    return 0;
  }
  const width = getAttribute(node, 'stroke-width') ?? getStyleValue(node, 'stroke-width');
  return parseLength(width, 1);
};

const createBounds = () => ({
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
});

const expandBounds = (bounds, x, y) => {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
};

const mergeBounds = (target, source) => {
  if (!source) {
    return;
  }
  expandBounds(target, source.minX, source.minY);
  expandBounds(target, source.maxX, source.maxY);
};

const boundsValid = (bounds) =>
  Number.isFinite(bounds.minX) &&
  Number.isFinite(bounds.minY) &&
  Number.isFinite(bounds.maxX) &&
  Number.isFinite(bounds.maxY) &&
  bounds.maxX >= bounds.minX &&
  bounds.maxY >= bounds.minY;

const identityMatrix = () => [1, 0, 0, 1, 0, 0];

const multiplyMatrix = (m1, m2) => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

const applyMatrix = (matrix, point) => ({
  x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
  y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
});

const parseTransform = (transformString) => {
  if (!transformString) {
    return identityMatrix();
  }

  const transformRegex = /([a-zA-Z]+)\(([^)]*)\)/g;
  let match;
  let matrix = identityMatrix();

  while ((match = transformRegex.exec(transformString)) !== null) {
    const name = match[1];
    const rawParams = match[2]
      .trim()
      .split(/[ ,]+/)
      .filter(Boolean)
      .map((value) => parseNumber(value));

    let next = identityMatrix();
    switch (name) {
      case 'translate': {
        const [tx = 0, ty = 0] = rawParams;
        next = [1, 0, 0, 1, tx, ty];
        break;
      }
      case 'scale': {
        const [sx = 1, sy = sx] = rawParams;
        next = [sx, 0, 0, sy, 0, 0];
        break;
      }
      case 'rotate': {
        const [angle = 0, cx = 0, cy = 0] = rawParams;
        const rad = (angle * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rotation = [cos, sin, -sin, cos, 0, 0];
        if (rawParams.length > 1) {
          const translateTo = [1, 0, 0, 1, cx, cy];
          const translateBack = [1, 0, 0, 1, -cx, -cy];
          next = multiplyMatrix(translateTo, multiplyMatrix(rotation, translateBack));
        } else {
          next = rotation;
        }
        break;
      }
      case 'skewX': {
        const [angle = 0] = rawParams;
        const rad = (angle * Math.PI) / 180;
        next = [1, 0, Math.tan(rad), 1, 0, 0];
        break;
      }
      case 'skewY': {
        const [angle = 0] = rawParams;
        const rad = (angle * Math.PI) / 180;
        next = [1, Math.tan(rad), 0, 1, 0, 0];
        break;
      }
      case 'matrix': {
        if (rawParams.length >= 6) {
          next = rawParams.slice(0, 6);
        }
        break;
      }
      default:
        break;
    }

    // Transform lists are applied left-to-right, so multiply on the left.
    matrix = multiplyMatrix(next, matrix);
  }

  return matrix;
};

const applyMatrixToBounds = (bounds, matrix) => {
  if (!boundsValid(bounds)) {
    return null;
  }

  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
  ];

  const transformed = createBounds();
  corners.forEach((point) => {
    const next = applyMatrix(matrix, point);
    expandBounds(transformed, next.x, next.y);
  });

  return transformed;
};

const parsePoints = (pointsString) => {
  if (!pointsString) {
    return [];
  }
  const values = pointsString
    .trim()
    .split(/[ ,]+/)
    .filter(Boolean)
    .map((value) => parseNumber(value));

  const points = [];
  for (let i = 0; i < values.length; i += 2) {
    if (i + 1 >= values.length) {
      break;
    }
    points.push({ x: values[i], y: values[i + 1] });
  }
  return points;
};

const cubicBezierAt = (p0, p1, p2, p3, t) => {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return (
    p0 * mt2 * mt +
    3 * p1 * mt2 * t +
    3 * p2 * mt * t2 +
    p3 * t2 * t
  );
};

const quadraticBezierAt = (p0, p1, p2, t) => {
  const mt = 1 - t;
  return p0 * mt * mt + 2 * p1 * mt * t + p2 * t * t;
};

const cubicBezierBounds = (p0, p1, p2, p3) => {
  const bounds = createBounds();

  const addPoint = (t) => {
    const x = cubicBezierAt(p0.x, p1.x, p2.x, p3.x, t);
    const y = cubicBezierAt(p0.y, p1.y, p2.y, p3.y, t);
    expandBounds(bounds, x, y);
  };

  addPoint(0);
  addPoint(1);

  const solveQuadratic = (a, b, c) => {
    if (Math.abs(a) < EPSILON) {
      if (Math.abs(b) < EPSILON) {
        return [];
      }
      return [-c / b];
    }
    const disc = b * b - 4 * a * c;
    if (disc < 0) {
      return [];
    }
    const sqrtDisc = Math.sqrt(disc);
    return [(-b + sqrtDisc) / (2 * a), (-b - sqrtDisc) / (2 * a)];
  };

  const derive = (p0c, p1c, p2c, p3c) => {
    const a = -p0c + 3 * p1c - 3 * p2c + p3c;
    const b = 2 * (p0c - 2 * p1c + p2c);
    const c = p1c - p0c;
    return solveQuadratic(a, b, c);
  };

  derive(p0.x, p1.x, p2.x, p3.x).forEach((t) => {
    if (t > 0 && t < 1) {
      addPoint(t);
    }
  });
  derive(p0.y, p1.y, p2.y, p3.y).forEach((t) => {
    if (t > 0 && t < 1) {
      addPoint(t);
    }
  });

  return bounds;
};

const quadraticBezierBounds = (p0, p1, p2) => {
  const bounds = createBounds();

  const addPoint = (t) => {
    const x = quadraticBezierAt(p0.x, p1.x, p2.x, t);
    const y = quadraticBezierAt(p0.y, p1.y, p2.y, t);
    expandBounds(bounds, x, y);
  };

  addPoint(0);
  addPoint(1);

  const derive = (p0c, p1c, p2c) => {
    const denom = p0c - 2 * p1c + p2c;
    if (Math.abs(denom) < EPSILON) {
      return null;
    }
    return (p0c - p1c) / denom;
  };

  const tx = derive(p0.x, p1.x, p2.x);
  if (tx !== null && tx > 0 && tx < 1) {
    addPoint(tx);
  }
  const ty = derive(p0.y, p1.y, p2.y);
  if (ty !== null && ty > 0 && ty < 1) {
    addPoint(ty);
  }

  return bounds;
};

const angleBetween = (u, v) => {
  const dot = u.x * v.x + u.y * v.y;
  const det = u.x * v.y - u.y * v.x;
  return Math.atan2(det, dot);
};

const arcToCenter = (p0, p1, rx, ry, phi, largeArc, sweep) => {
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);

  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  let rxAbs = Math.abs(rx);
  let ryAbs = Math.abs(ry);

  const lambda = (x1p * x1p) / (rxAbs * rxAbs) + (y1p * y1p) / (ryAbs * ryAbs);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rxAbs *= scale;
    ryAbs *= scale;
  }

  const rx2 = rxAbs * rxAbs;
  const ry2 = ryAbs * ryAbs;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;

  const sign = largeArc === sweep ? -1 : 1;
  let numerator = rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2;
  let denom = rx2 * y1p2 + ry2 * x1p2;
  if (denom === 0) {
    denom = 1;
  }
  let coeff = numerator / denom;
  if (coeff < 0) {
    coeff = 0;
  }
  const factor = sign * Math.sqrt(coeff);

  const cxp = factor * ((rxAbs * y1p) / ryAbs);
  const cyp = factor * (-(ryAbs * x1p) / rxAbs);

  const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2;

  const vectorU = { x: (x1p - cxp) / rxAbs, y: (y1p - cyp) / ryAbs };
  const vectorV = { x: (-x1p - cxp) / rxAbs, y: (-y1p - cyp) / ryAbs };

  let startAngle = Math.atan2(vectorU.y, vectorU.x);
  let deltaAngle = angleBetween(vectorU, vectorV);

  if (!sweep && deltaAngle > 0) {
    deltaAngle -= Math.PI * 2;
  }
  if (sweep && deltaAngle < 0) {
    deltaAngle += Math.PI * 2;
  }

  return {
    cx,
    cy,
    rx: rxAbs,
    ry: ryAbs,
    phi,
    startAngle,
    deltaAngle,
  };
};

const angleWithin = (angle, start, delta) => {
  const twoPi = Math.PI * 2;
  let end = start + delta;
  const normalize = (value) => {
    let v = value % twoPi;
    if (v < 0) {
      v += twoPi;
    }
    return v;
  };

  const a = normalize(angle);
  const s = normalize(start);
  const e = normalize(end);

  if (delta >= 0) {
    if (s <= e) {
      return a >= s && a <= e;
    }
    return a >= s || a <= e;
  }

  if (s >= e) {
    return a <= s && a >= e;
  }
  return a <= s || a >= e;
};

const arcBounds = (p0, p1, rx, ry, phi, largeArc, sweep) => {
  if (rx === 0 || ry === 0) {
    const bounds = createBounds();
    expandBounds(bounds, p0.x, p0.y);
    expandBounds(bounds, p1.x, p1.y);
    return bounds;
  }

  const center = arcToCenter(p0, p1, rx, ry, phi, largeArc, sweep);
  const { cx, cy, rx: rxAbs, ry: ryAbs, startAngle, deltaAngle } = center;

  const bounds = createBounds();

  const pushAngle = (angle) => {
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const x = cx + rxAbs * cosPhi * cosA - ryAbs * sinPhi * sinA;
    const y = cy + rxAbs * sinPhi * cosA + ryAbs * cosPhi * sinA;
    expandBounds(bounds, x, y);
  };

  pushAngle(startAngle);
  pushAngle(startAngle + deltaAngle);

  const quadrantAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  quadrantAngles.forEach((angle) => {
    if (angleWithin(angle, startAngle, deltaAngle)) {
      pushAngle(angle);
    }
  });

  return bounds;
};

const parsePathData = (d) => {
  if (!d) {
    return [];
  }
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!tokens) {
    return [];
  }

  const segments = [];
  let index = 0;
  let currentCommand = null;
  const paramLength = {
    M: 2,
    L: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    T: 2,
    A: 7,
    Z: 0,
  };

  const isCommand = (value) => /[a-zA-Z]/.test(value);

  while (index < tokens.length) {
    const token = tokens[index];
    if (isCommand(token)) {
      currentCommand = token;
      index += 1;
      if (currentCommand === 'Z' || currentCommand === 'z') {
        segments.push({ command: currentCommand, args: [] });
      }
      continue;
    }

    if (!currentCommand) {
      break;
    }

    const commandUpper = currentCommand.toUpperCase();
    const params = paramLength[commandUpper];
    if (params === undefined) {
      break;
    }

    const args = [];
    while (args.length < params && index < tokens.length) {
      const value = tokens[index];
      if (isCommand(value)) {
        break;
      }
      args.push(parseNumber(value));
      index += 1;
    }

    if (args.length < params) {
      break;
    }

    segments.push({ command: currentCommand, args });

    if ((commandUpper === 'M' || commandUpper === 'm') && args.length === params) {
      const nextIndex = index;
      const nextToken = tokens[nextIndex];
      if (nextToken && !isCommand(nextToken)) {
        currentCommand = currentCommand === 'M' ? 'L' : 'l';
      }
    }
  }

  return segments;
};

const computePathBounds = (d) => {
  const segments = parsePathData(d);
  const bounds = createBounds();
  let current = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let prevCubicControl = null;
  let prevQuadControl = null;
  let prevCommand = null;

  const addBounds = (segmentBounds) => {
    mergeBounds(bounds, segmentBounds);
  };

  segments.forEach((segment) => {
    const command = segment.command;
    const isRelative = command === command.toLowerCase();
    const type = command.toUpperCase();

    const getPoint = (x, y) =>
      isRelative ? { x: current.x + x, y: current.y + y } : { x, y };

    switch (type) {
      case 'M': {
        const point = getPoint(segment.args[0], segment.args[1]);
        current = point;
        start = point;
        prevCubicControl = null;
        prevQuadControl = null;
        break;
      }
      case 'L': {
        const point = getPoint(segment.args[0], segment.args[1]);
        const segmentBounds = createBounds();
        expandBounds(segmentBounds, current.x, current.y);
        expandBounds(segmentBounds, point.x, point.y);
        addBounds(segmentBounds);
        current = point;
        prevCubicControl = null;
        prevQuadControl = null;
        break;
      }
      case 'H': {
        const x = isRelative ? current.x + segment.args[0] : segment.args[0];
        const point = { x, y: current.y };
        const segmentBounds = createBounds();
        expandBounds(segmentBounds, current.x, current.y);
        expandBounds(segmentBounds, point.x, point.y);
        addBounds(segmentBounds);
        current = point;
        prevCubicControl = null;
        prevQuadControl = null;
        break;
      }
      case 'V': {
        const y = isRelative ? current.y + segment.args[0] : segment.args[0];
        const point = { x: current.x, y };
        const segmentBounds = createBounds();
        expandBounds(segmentBounds, current.x, current.y);
        expandBounds(segmentBounds, point.x, point.y);
        addBounds(segmentBounds);
        current = point;
        prevCubicControl = null;
        prevQuadControl = null;
        break;
      }
      case 'C': {
        const p1 = getPoint(segment.args[0], segment.args[1]);
        const p2 = getPoint(segment.args[2], segment.args[3]);
        const p3 = getPoint(segment.args[4], segment.args[5]);
        const segmentBounds = cubicBezierBounds(current, p1, p2, p3);
        addBounds(segmentBounds);
        current = p3;
        prevCubicControl = p2;
        prevQuadControl = null;
        break;
      }
      case 'S': {
        const p2 = getPoint(segment.args[0], segment.args[1]);
        const p3 = getPoint(segment.args[2], segment.args[3]);
        let p1 = current;
        if (prevCommand && (prevCommand === 'C' || prevCommand === 'S')) {
          p1 = {
            x: current.x * 2 - prevCubicControl.x,
            y: current.y * 2 - prevCubicControl.y,
          };
        }
        const segmentBounds = cubicBezierBounds(current, p1, p2, p3);
        addBounds(segmentBounds);
        current = p3;
        prevCubicControl = p2;
        prevQuadControl = null;
        break;
      }
      case 'Q': {
        const p1 = getPoint(segment.args[0], segment.args[1]);
        const p2 = getPoint(segment.args[2], segment.args[3]);
        const segmentBounds = quadraticBezierBounds(current, p1, p2);
        addBounds(segmentBounds);
        current = p2;
        prevQuadControl = p1;
        prevCubicControl = null;
        break;
      }
      case 'T': {
        const p2 = getPoint(segment.args[0], segment.args[1]);
        let p1 = current;
        if (prevCommand && (prevCommand === 'Q' || prevCommand === 'T')) {
          p1 = {
            x: current.x * 2 - prevQuadControl.x,
            y: current.y * 2 - prevQuadControl.y,
          };
        }
        const segmentBounds = quadraticBezierBounds(current, p1, p2);
        addBounds(segmentBounds);
        current = p2;
        prevQuadControl = p1;
        prevCubicControl = null;
        break;
      }
      case 'A': {
        const rx = segment.args[0];
        const ry = segment.args[1];
        const angle = (segment.args[2] * Math.PI) / 180;
        const largeArc = Boolean(segment.args[3]);
        const sweep = Boolean(segment.args[4]);
        const p1 = getPoint(segment.args[5], segment.args[6]);
        const segmentBounds = arcBounds(current, p1, rx, ry, angle, largeArc, sweep);
        addBounds(segmentBounds);
        current = p1;
        prevCubicControl = null;
        prevQuadControl = null;
        break;
      }
      case 'Z': {
        const segmentBounds = createBounds();
        expandBounds(segmentBounds, current.x, current.y);
        expandBounds(segmentBounds, start.x, start.y);
        addBounds(segmentBounds);
        current = start;
        prevCubicControl = null;
        prevQuadControl = null;
        break;
      }
      default:
        break;
    }

    prevCommand = type;
  });

  return boundsValid(bounds) ? bounds : null;
};

const computeShapeBounds = (node) => {
  const tag = node[0]?.tagName;
  if (!tag) {
    return null;
  }

  const strokeWidth = getStrokeWidth(node);
  const expandStroke = (bounds) => {
    if (!bounds || strokeWidth <= 0) {
      return bounds;
    }
    return {
      minX: bounds.minX - strokeWidth / 2,
      minY: bounds.minY - strokeWidth / 2,
      maxX: bounds.maxX + strokeWidth / 2,
      maxY: bounds.maxY + strokeWidth / 2,
    };
  };

  switch (tag) {
    case 'path': {
      const d = getAttribute(node, 'd');
      return expandStroke(computePathBounds(d));
    }
    case 'circle': {
      const cx = parseLength(getAttribute(node, 'cx'));
      const cy = parseLength(getAttribute(node, 'cy'));
      const r = parseLength(getAttribute(node, 'r'));
      const bounds = createBounds();
      expandBounds(bounds, cx - r, cy - r);
      expandBounds(bounds, cx + r, cy + r);
      return expandStroke(bounds);
    }
    case 'ellipse': {
      const cx = parseLength(getAttribute(node, 'cx'));
      const cy = parseLength(getAttribute(node, 'cy'));
      const rx = parseLength(getAttribute(node, 'rx'));
      const ry = parseLength(getAttribute(node, 'ry'));
      const bounds = createBounds();
      expandBounds(bounds, cx - rx, cy - ry);
      expandBounds(bounds, cx + rx, cy + ry);
      return expandStroke(bounds);
    }
    case 'rect': {
      const x = parseLength(getAttribute(node, 'x'));
      const y = parseLength(getAttribute(node, 'y'));
      const width = parseLength(getAttribute(node, 'width'));
      const height = parseLength(getAttribute(node, 'height'));
      const bounds = createBounds();
      expandBounds(bounds, x, y);
      expandBounds(bounds, x + width, y + height);
      return expandStroke(bounds);
    }
    case 'line': {
      const x1 = parseLength(getAttribute(node, 'x1'));
      const y1 = parseLength(getAttribute(node, 'y1'));
      const x2 = parseLength(getAttribute(node, 'x2'));
      const y2 = parseLength(getAttribute(node, 'y2'));
      const bounds = createBounds();
      expandBounds(bounds, x1, y1);
      expandBounds(bounds, x2, y2);
      return expandStroke(bounds);
    }
    case 'polyline':
    case 'polygon': {
      const points = parsePoints(getAttribute(node, 'points'));
      if (points.length === 0) {
        return null;
      }
      const bounds = createBounds();
      points.forEach((point) => expandBounds(bounds, point.x, point.y));
      return expandStroke(bounds);
    }
    case 'image': {
      const x = parseLength(getAttribute(node, 'x'));
      const y = parseLength(getAttribute(node, 'y'));
      const width = parseLength(getAttribute(node, 'width'));
      const height = parseLength(getAttribute(node, 'height'));
      const bounds = createBounds();
      expandBounds(bounds, x, y);
      expandBounds(bounds, x + width, y + height);
      return bounds;
    }
    default:
      return null;
  }
};

const computeBounds = ($) => {
  const $root = $.root();
  const idMap = new Map();
  $root.find('[id]').each((_, element) => {
    const node = $(element);
    const id = node.attr('id');
    if (id) {
      idMap.set(id, node);
    }
  });

  const cachedRefBounds = new Map();
  const visiting = new Set();

  const getRefBounds = (id) => {
    if (cachedRefBounds.has(id)) {
      return cachedRefBounds.get(id);
    }
    if (visiting.has(id)) {
      return null;
    }
    const node = idMap.get(id);
    if (!node) {
      return null;
    }
    visiting.add(id);
    const bounds = traverse(node, identityMatrix());
    visiting.delete(id);
    cachedRefBounds.set(id, bounds);
    return bounds;
  };

  const traverse = (node, parentMatrix) => {
    const tag = node[0]?.tagName;
    if (!tag) {
      return null;
    }

    if (tag === 'defs' || tag === 'metadata' || tag === 'title' || tag === 'desc') {
      return null;
    }

    const display = getAttribute(node, 'display') ?? getStyleValue(node, 'display');
    const visibility = getAttribute(node, 'visibility') ?? getStyleValue(node, 'visibility');
    if (display === 'none' || visibility === 'hidden') {
      return null;
    }

    const nodeTransform = parseTransform(getAttribute(node, 'transform'));
    const currentMatrix = multiplyMatrix(parentMatrix, nodeTransform);

    if (tag === 'use') {
      const href =
        getAttribute(node, 'href') || getAttribute(node, 'xlink:href');
      if (!href || !href.startsWith('#')) {
        return null;
      }
      const refId = href.slice(1);
      const refBounds = getRefBounds(refId);
      if (!refBounds) {
        return null;
      }
      const x = parseLength(getAttribute(node, 'x'));
      const y = parseLength(getAttribute(node, 'y'));
      const translation = [1, 0, 0, 1, x, y];
      const useMatrix = multiplyMatrix(currentMatrix, translation);
      return applyMatrixToBounds(refBounds, useMatrix);
    }

    if (isRenderableTag(tag)) {
      const localBounds = computeShapeBounds(node);
      if (!localBounds) {
        return null;
      }
      return applyMatrixToBounds(localBounds, currentMatrix);
    }

    if (isContainerTag(tag)) {
      const combined = createBounds();
      node.children().each((_, child) => {
        const childNode = $(child);
        const childBounds = traverse(childNode, currentMatrix);
        mergeBounds(combined, childBounds);
      });
      return boundsValid(combined) ? combined : null;
    }

    return null;
  };

  return traverse($root.find('svg').first(), identityMatrix());
};

const updateSvg = (svgMarkup) => {
  const $ = cheerio.load(svgMarkup, { xmlMode: true });
  const $svg = $('svg').first();
  if (!$svg.length) {
    return null;
  }

  const bounds = computeBounds($);
  if (!bounds || !boundsValid(bounds)) {
    return null;
  }

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width <= 0 || height <= 0) {
    return null;
  }

  const padding = Math.max(MIN_PADDING, Math.min(width, height) * PADDING_RATIO);
  const paddedBounds = {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };
  const paddedWidth = paddedBounds.maxX - paddedBounds.minX;
  const paddedHeight = paddedBounds.maxY - paddedBounds.minY;

  $svg.attr(
    'viewBox',
    `${formatNumber(paddedBounds.minX)} ${formatNumber(paddedBounds.minY)} ${formatNumber(paddedWidth)} ${formatNumber(paddedHeight)}`,
  );

  if ($svg.attr('width')) {
    $svg.attr('width', formatNumber(paddedWidth));
  }
  if ($svg.attr('height')) {
    $svg.attr('height', formatNumber(paddedHeight));
  }

  return $.xml();
};

const run = async () => {
  const dirEntries = await fs.readdir(resourcesDir, { withFileTypes: true });
  const svgFiles = dirEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.svg'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (svgFiles.length === 0) {
    console.log(`No SVG files found in ${resourcesDir}`);
    return;
  }

  let changed = 0;

  for (const fileName of svgFiles) {
    const filePath = path.join(resourcesDir, fileName);
    const original = await fs.readFile(filePath, 'utf8');
    const updated = updateSvg(original);

    if (!updated) {
      console.log(`${fileName}: skipped`);
      continue;
    }

    if (updated !== original) {
      await fs.writeFile(filePath, updated, 'utf8');
      changed += 1;
      console.log(`${fileName}: trimmed`);
    } else {
      console.log(`${fileName}: unchanged`);
    }
  }

  console.log(`\nTrimmed ${changed}/${svgFiles.length} SVG files.`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
