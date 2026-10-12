import { skyboxById, skyboxesByPack } from "@battlebeasts/shared";
import { docStore, useEditorSlice } from "../state/docStore";

/** Sky preset for the open map. Empty keeps the flat editor background. */
export function SkyPanel() {
  const preset = useEditorSlice((s) => s.doc.env.skyPreset ?? "");
  const groups = skyboxesByPack();
  const current = skyboxById(preset || undefined);
  const thumb = current?.url;

  return (
    <div className="section">
      <h3>Sky</h3>
      <div className="row">
        <label>Preset</label>
        <select
          value={preset}
          onChange={(e) => {
            const id = e.target.value;
            docStore.edit((d) => {
              if (id) d.env.skyPreset = id;
              else delete d.env.skyPreset;
            });
          }}
          style={{ flex: 1 }}
        >
          <option value="">Flat colour</option>
          {groups.map(({ pack, items }) => (
            <optgroup key={pack} label={pack}>
              {items.map((sky) => (
                <option key={sky.id} value={sky.id}>
                  {sky.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {thumb && (
        <img
          src={thumb}
          alt=""
          style={{ width: "100%", height: 96, objectFit: "cover", objectPosition: "center 42%", borderRadius: 4, display: "block" }}
        />
      )}
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Skies from the packs. A flat colour is the match haze used when a map has no sky.
      </div>
    </div>
  );
}
