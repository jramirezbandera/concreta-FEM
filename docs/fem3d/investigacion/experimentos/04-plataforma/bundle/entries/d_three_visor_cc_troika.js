// c + camera-controls + troika-three-text + ViewHelper
import "./c_three_visor.js";
import CameraControls from "camera-controls";
import { Text } from "troika-three-text";
import { ViewHelper } from "three/examples/jsm/helpers/ViewHelper.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
window.X = { CameraControls, Text, ViewHelper, CSS2DRenderer, CSS2DObject };
