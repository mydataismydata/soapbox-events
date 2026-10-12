// The survey form's helper (served as /assets/survey.js). Everything here
// only makes the form easier to use: without it, a ranking is a number box
// beside each choice, and the server checks every answer either way.
//
//   - A ranking becomes a list you tap in order: the first tap is 1, the
//     next 2, and a second tap takes a choice out. The number boxes stay in
//     the form, hidden, and carry the order.
//   - A multiple choice with a limit stops taking ticks at the limit.
//   - Typing an Other answer ticks Other.
(function () {
  'use strict';

  function ranking(list) {
    var hint = list.previousElementSibling;
    if (hint && hint.dataset.jsHint) hint.textContent = hint.dataset.jsHint;

    var items = [].slice.call(list.querySelectorAll('li')).map(function (li) {
      var select = li.querySelector('select');
      var label = li.querySelector('.sv-rank-label').textContent;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'sv-rank-item';
      var badge = document.createElement('span');
      badge.className = 'sv-rank-badge';
      badge.setAttribute('aria-hidden', 'true');
      var text = document.createElement('span');
      text.className = 'sv-rank-label';
      text.textContent = label;
      button.appendChild(badge);
      button.appendChild(text);
      li.className = '';
      li.textContent = '';
      select.hidden = true;
      li.appendChild(select);
      li.appendChild(button);
      return { select: select, button: button, badge: badge, label: label };
    });

    // The order already chosen, if the form was drawn again.
    var order = items
      .filter(function (it) { return it.select.value; })
      .sort(function (a, b) { return Number(a.select.value) - Number(b.select.value); });

    var reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'sv-rank-reset';
    reset.textContent = 'Start over';
    list.parentNode.insertBefore(reset, list.nextSibling);

    function draw() {
      items.forEach(function (it) {
        var place = order.indexOf(it) + 1;
        it.select.value = place ? String(place) : '';
        it.badge.textContent = place ? String(place) : '';
        it.button.classList.toggle('is-ranked', Boolean(place));
        it.button.setAttribute('aria-pressed', place ? 'true' : 'false');
        it.button.setAttribute('aria-label', place ? it.label + ', number ' + place : it.label + ', not placed yet');
      });
      reset.hidden = order.length === 0;
    }

    items.forEach(function (it) {
      it.button.addEventListener('click', function () {
        var at = order.indexOf(it);
        if (at === -1) order.push(it);
        else order.splice(at, 1);
        draw();
      });
    });
    reset.addEventListener('click', function () {
      order = [];
      draw();
      if (items[0]) items[0].button.focus();
    });
    draw();
  }

  function capped(group) {
    var max = Number(group.dataset.max);
    var boxes = [].slice.call(group.querySelectorAll('input[type="checkbox"]'));
    function apply() {
      var full = boxes.filter(function (b) { return b.checked; }).length >= max;
      boxes.forEach(function (b) {
        b.disabled = full && !b.checked;
        b.closest('.sv-choice').classList.toggle('is-capped', b.disabled);
      });
    }
    boxes.forEach(function (b) { b.addEventListener('change', apply); });
    apply();
  }

  function otherBoxes(form) {
    [].slice.call(form.querySelectorAll('.sv-other-text')).forEach(function (field) {
      var mark = field.closest('.sv-other').querySelector('input[value="other"]');
      field.addEventListener('input', function () {
        if (field.value.trim() && !mark.checked && !mark.disabled) {
          mark.checked = true;
          mark.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
  }

  function start() {
    [].slice.call(document.querySelectorAll('.sv-form')).forEach(function (form) {
      [].slice.call(form.querySelectorAll('ol[data-rank]')).forEach(ranking);
      [].slice.call(form.querySelectorAll('.sv-choices[data-max]')).forEach(capped);
      otherBoxes(form);
      // One press sends the form once.
      form.addEventListener('submit', function () {
        var button = form.querySelector('.sv-submit');
        setTimeout(function () { if (button) button.disabled = true; }, 0);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
