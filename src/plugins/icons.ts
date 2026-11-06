import { App as VueApp } from 'vue'
import ChevronDownIcon from 'vue-material-design-icons/ChevronDown.vue'
import ChevronUpIcon from 'vue-material-design-icons/ChevronUp.vue'
import ChevronRightIcon from 'vue-material-design-icons/ChevronRight.vue'
import PlusThickIcon from 'vue-material-design-icons/PlusThick.vue'
import MinusThickIcon from 'vue-material-design-icons/MinusThick.vue'
import ArrowUpIcon from 'vue-material-design-icons/ArrowUp.vue'
import ArrowRightIcon from 'vue-material-design-icons/ArrowRight.vue'
import CheckCircleIcon from 'vue-material-design-icons/CheckCircle.vue'
import SegmentIcon from 'vue-material-design-icons/Segment.vue'
import CloseIcon from 'vue-material-design-icons/Close.vue'
// Import other icons as needed

export default {
  install(app: VueApp) {
    app.component('ChevronDownIcon', ChevronDownIcon)
    app.component('ChevronUpIcon', ChevronUpIcon)
    app.component('ChevronRightIcon', ChevronRightIcon)
    app.component('PlusThickIcon', PlusThickIcon)
    app.component('MinusThickIcon', MinusThickIcon)
    app.component('ArrowUpIcon', ArrowUpIcon)
    app.component('ArrowRightIcon', ArrowRightIcon)
    app.component('CheckCircleIcon', CheckCircleIcon)
    app.component('SegmentIcon', SegmentIcon)
    app.component('CloseIcon', CloseIcon)

    // Register other icons globally
  }
}
