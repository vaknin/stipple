<script lang="ts">
  // Typist's cropper (crop.js) over the preview, square or of the screen's aspect (Crop to screen).
  // It moves the crop live (the art follows under it), Done commits one history step, Cancel /
  // Escape restores the crop from before.
  import { createCropper } from '$typist/crop.js';
  import { autoCrop } from '$typist/imageio.js';
  import { CROP_DEFAULTS, type Crop } from '$typist/tone.js';
  import { onMount } from 'svelte';
  import { app, squareCrop } from '../state.svelte';

  let host: HTMLDivElement;

  onMount(() => {
    const loaded = app.loaded;
    if (!loaded) { app.cropping = false; return; }
    const start: Crop = { ...app.doc.crop };
    // the frame has the crop's aspect; the doc keeps only the position (the aspect is derived)
    const aspect = app.cropAspect;
    const withAspect = (c: Crop): Crop => (aspect === 1 ? { ...c } : { ...c, aspect });
    let done = false;

    const finish = (apply: boolean, c?: Crop, changed = true) => {
      if (done) return;
      done = true;
      // Done without a change keeps the exact crop from before (crop.js rounds to 5 decimals)
      const keep = !apply || !changed;
      app.doc.crop = keep ? start : squareCrop({ ...CROP_DEFAULTS, ...(c ?? app.doc.crop) });
      if (!keep) app.commit('Crop');
      app.cropping = false;
    };

    const api = createCropper({
      host,
      image: loaded.photo.canvas,
      crop: withAspect(start),
      onChange: c => { if (!done) app.doc.crop = squareCrop({ ...CROP_DEFAULTS, ...c }); },
      onCommit: (c, info) => finish(true, c, !info || info.changed !== false),
      onCancel: () => finish(false),
      // cut-outs fit their visible area, photos the whole frame (app.js)
      fitCrop: () => autoCrop(loaded.photo, aspect),
    });
    // enter once the host has its size, so the frame is measured right
    const raf = requestAnimationFrame(() => api.enter(withAspect(start)));

    // torn down from outside (a new photo, a shortcut): leave app.doc.crop to whoever did that
    return () => {
      cancelAnimationFrame(raf);
      done = true;
      api.destroy();
    };
  });
</script>

<div class="crop" bind:this={host}></div>

<style>
  .crop { position: absolute; inset: 0; z-index: 5; }
</style>
