// b + OrbitControls + fat lines + three-mesh-bvh + BatchedMesh
import { WebGLRenderer, Scene, PerspectiveCamera, OrthographicCamera, InstancedMesh, BatchedMesh, BufferGeometry, BufferAttribute,
  Float32BufferAttribute, MeshBasicMaterial, MeshLambertMaterial, LineBasicMaterial, LineSegments, Mesh, Group,
  AmbientLight, DirectionalLight, Color, Matrix4, Vector3, Quaternion, Raycaster, Plane, DataTexture, CylinderGeometry,
  BoxGeometry, DoubleSide, Box3, Sphere } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
window.T = { WebGLRenderer, Scene, PerspectiveCamera, OrthographicCamera, InstancedMesh, BatchedMesh, BufferGeometry, BufferAttribute,
  Float32BufferAttribute, MeshBasicMaterial, MeshLambertMaterial, LineBasicMaterial, LineSegments, Mesh, Group,
  AmbientLight, DirectionalLight, Color, Matrix4, Vector3, Quaternion, Raycaster, Plane, DataTexture, CylinderGeometry,
  BoxGeometry, DoubleSide, Box3, Sphere, OrbitControls, LineSegments2, LineSegmentsGeometry, LineMaterial,
  computeBoundsTree, disposeBoundsTree, acceleratedRaycast };
