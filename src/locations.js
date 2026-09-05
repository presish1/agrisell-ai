let counter = 0;
export function bindLocation(input, api, initialId = "", onSelect = () => {}) {
  input.setAttribute("aria-label",input.closest("label")?.firstChild?.textContent?.trim() || "Location");
  const list = document.createElement("datalist");
  list.id = "places-" + ++counter;
  input.setAttribute("list",list.id);
  input.setAttribute("autocomplete","off");
  input.placeholder = "Search village, town or city…";
  input.after(list);
  const id = document.createElement("input");
  id.type = "hidden"; id.name = "locationId"; id.value = initialId || "";
  input.after(id);
  const hint = document.createElement("small");
  hint.className = "location-hint";
  hint.textContent = "Choose a result to attach coordinates and region.";
  list.after(hint);
  let choices = [], timer, generation = 0;
  const original = input.value;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const version = ++generation;
    const choice = choices.find(place => place.label === input.value);
    id.value = choice?.id || (input.value === original ? initialId || "" : "");
    input.setCustomValidity(choice || input.value === original ? "" : "Choose a location from the search results.");
    if (choice) {
      hint.textContent = choice.state + " · " + choice.latitude.toFixed(4) + ", " + choice.longitude.toFixed(4);
      onSelect(choice); return;
    }
    list.replaceChildren();
    if (input.value.trim().length < 2) { hint.textContent = "Type at least two letters."; return; }
    timer = setTimeout(async () => {
      hint.textContent = "Searching locations…";
      try {
        const results = await api("/api/locations?q=" + encodeURIComponent(input.value));
        if (generation !== version || !input.isConnected) return;
        choices = results;
        list.replaceChildren(...results.map(place => { const option=document.createElement("option"); option.value=place.label; return option; }));
        hint.textContent = results.length ? "Choose a result from the dropdown." : "No matching locations. Try a nearby town.";
      } catch (error) { if (generation === version && input.isConnected) hint.textContent = error.message; }
    }, 300);
  });
}
