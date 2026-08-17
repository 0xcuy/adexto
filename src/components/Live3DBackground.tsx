"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function Live3DBackground() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    let width = window.innerWidth;
    let height = window.innerHeight;

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(0, 0, 8.5);

    const masterGroup = new THREE.Group();
    scene.add(masterGroup);

    // 1. Fibonacci Swarm of Nodes
    const nodeCount = 180;
    const radius = 3.8;
    const nodes: THREE.Vector3[] = [];
    
    for (let i = 0; i < nodeCount; i++) {
      const y = 1 - (i / (nodeCount - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = i * 2.399963229;
      nodes.push(new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius));
    }

    const pointsGeo = new THREE.BufferGeometry().setFromPoints(nodes);
    const pointsMat = new THREE.PointsMaterial({
      color: 0x00f5ff,
      size: 0.07,
      transparent: true,
      opacity: 0.65,
    });
    const pointsMesh = new THREE.Points(pointsGeo, pointsMat);
    masterGroup.add(pointsMesh);

    // 2. Synaptic Mesh Edges
    const edgePositions: number[] = [];
    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        const dist = nodes[i].distanceTo(nodes[j]);
        if (dist < 1.35) {
          edgePositions.push(nodes[i].x, nodes[i].y, nodes[i].z);
          edgePositions.push(nodes[j].x, nodes[j].y, nodes[j].z);
        }
      }
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x7c3aed,
      transparent: true,
      opacity: 0.18,
    });
    const edgeMesh = new THREE.LineSegments(edgeGeo, edgeMat);
    masterGroup.add(edgeMesh);

    // 3. Central Cryptographic Core
    const coreGeo = new THREE.IcosahedronGeometry(1.2, 1);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x9333ea,
      wireframe: true,
      transparent: true,
      opacity: 0.45,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    masterGroup.add(coreMesh);

    const innerCoreGeo = new THREE.OctahedronGeometry(0.7, 0);
    const innerCoreMat = new THREE.MeshBasicMaterial({
      color: 0x00f5ff,
      wireframe: true,
      transparent: true,
      opacity: 0.55,
    });
    const innerCoreMesh = new THREE.Mesh(innerCoreGeo, innerCoreMat);
    masterGroup.add(innerCoreMesh);

    let targetMouseX = 0;
    let targetMouseY = 0;
    let currentMouseX = 0;
    let currentMouseY = 0;
    let rafId = 0;

    const handleMouseMove = (e: MouseEvent) => {
      targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    const clock = new THREE.Clock();
    const animate = () => {
      const delta = clock.getElapsedTime();

      currentMouseX += (targetMouseX - currentMouseX) * 0.05;
      currentMouseY += (targetMouseY - currentMouseY) * 0.05;

      masterGroup.rotation.y = delta * 0.12 + currentMouseX * 0.4;
      masterGroup.rotation.x = Math.sin(delta * 0.2) * 0.08 - currentMouseY * 0.25;

      coreMesh.rotation.y = -delta * 0.25;
      coreMesh.rotation.x = delta * 0.15;

      innerCoreMesh.rotation.y = delta * 0.5;
      innerCoreMesh.rotation.z = -delta * 0.3;
      const scale = 1 + Math.sin(delta * 2.2) * 0.06;
      innerCoreMesh.scale.set(scale, scale, scale);

      renderer?.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      if (renderer) {
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", handleResize);
      pointsGeo.dispose();
      pointsMat.dispose();
      edgeGeo.dispose();
      edgeMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      innerCoreGeo.dispose();
      innerCoreMat.dispose();
      renderer?.dispose();
      if (renderer?.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div 
      ref={mountRef} 
      className="fixed inset-0 pointer-events-none z-0 opacity-50" 
      aria-hidden="true"
    />
  );
}
