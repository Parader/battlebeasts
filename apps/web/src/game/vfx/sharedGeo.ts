import * as THREE from "three";

/**
 * Module-level geometries shared across spell one-shots.
 * Uploaded once; safe to attach to many meshes (read-only use).
 */

export const GEO_SPHERE_LO = new THREE.SphereGeometry(1, 8, 8);
export const GEO_SPHERE_MD = new THREE.SphereGeometry(1, 10, 10);
export const GEO_SPHERE_HI = new THREE.SphereGeometry(1, 12, 12);
export const GEO_SPHERE_TINY = new THREE.SphereGeometry(1, 6, 6);

export const GEO_OCTA = new THREE.OctahedronGeometry(1, 0);

export const GEO_RING_IMPACT = new THREE.RingGeometry(0.25, 0.55, 24);

/** Ice lance tip / shaft (authored radii). */
export const GEO_LANCE_TIP = new THREE.ConeGeometry(0.034, 0.2, 5);
export const GEO_LANCE_SHAFT = new THREE.CylinderGeometry(0.018, 0.018, 0.1, 5);

/** Spikes stalks — all cones (no spheres) so tips stay sharp. */
export const GEO_SPIKE_STALK = new THREE.ConeGeometry(0.08, 1, 5);
/** Mid bulge / root collar — squat cone, not a ball. */
export const GEO_SPIKE_KNOB = new THREE.ConeGeometry(0.1, 0.28, 5);
export const GEO_SPIKE_THORN = new THREE.ConeGeometry(0.04, 0.75, 4);
/** Needle tip overlay — sharp cone, not a sphere. */
export const GEO_SPIKE_TIP = new THREE.ConeGeometry(0.028, 0.32, 4);
export const GEO_SPIKE_MIST = new THREE.SphereGeometry(1, 6, 6);
